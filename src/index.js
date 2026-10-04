function isValidQuery(query) {
    return query && query.length >= 5 && query.split(' ').length >= 3;
}

let accessKeys;
let accessKeysExpires = 0;

function decodeBase64Url(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function isAuthorized(request, env) {
    const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
    const audience = env.CF_ACCESS_AUD;
    if (!teamDomain || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) return false;

    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || token.length > 16384) return false;

    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
        const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (header.alg !== 'RS256' || !header.kid || !audiences.includes(audience)) return false;
        const now = Math.floor(Date.now() / 1000);
        if (claims.iss !== `https://${teamDomain}` || !Number.isFinite(claims.exp) || claims.exp <= now ||
            (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now))) return false;

        if (!accessKeys || accessKeysExpires <= now) {
            const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
            if (!response.ok) return false;
            const jwks = await response.json();
            accessKeys = jwks.keys;
            accessKeysExpires = now + 3600;
        }
        const jwk = accessKeys.find(key => key.kid === header.kid && key.kty === 'RSA');
        if (!jwk) return false;
        const publicKey = await crypto.subtle.importKey(
            'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
        );
        return crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            publicKey,
            decodeBase64Url(parts[2]),
            new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
        );
    } catch {
        return false;
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
}

function photoKey(photoUrl) {
    if (typeof photoUrl !== 'string' || !/^\/[a-zA-Z0-9_\u0400-\u04FF-]+\.(?:jpg|jpeg|png|webp)$/i.test(photoUrl)) {
        return null;
    }
    return photoUrl.slice(1);
}

function isImage(bytes, extension) {
    if (extension === 'jpg' || extension === 'jpeg') {
        return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (extension === 'png') {
        return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    }
    return extension === 'webp' && bytes.length >= 12 &&
        String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}

async function saveRecord(payload, env) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const fields = [
        id,
        payload.last_name,
        payload.first_name,
        payload.middle_name,
        payload.rank || '',
        payload.date_of_birth || '',
        payload.date_of_death || '',
        payload.service_history
    ];
    if (!/^[a-zA-Z0-9_\u0400-\u04FF-]{1,100}$/.test(id) ||
        fields.slice(1, 4).some(value => typeof value !== 'string' || !value.trim()) ||
        typeof payload.service_history !== 'string' || !payload.service_history.trim()) {
        return jsonResponse({ error: 'Перевірте обов’язкові поля запису' }, 400);
    }

    const existing = await env.memorial_db.prepare(
        'SELECT photo_url FROM memorial WHERE id = ?'
    ).bind(id).first();
    const oldPhotoKey = photoKey(existing?.photo_url);
    let photoUrl = existing?.photo_url || null;
    let newPhotoKey = null;

    if (payload.photoBase64) {
        const ext = typeof payload.photoExt === 'string' ? payload.photoExt.toLowerCase() : '';
        const contentTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        if (!contentTypes[ext] || typeof payload.photoBase64 !== 'string' || payload.photoBase64.length > 11_200_000) {
            return jsonResponse({ error: 'Недійсний формат або розмір фотографії' }, 400);
        }
        let photoBytes;
        try {
            photoBytes = decodeBase64Url(payload.photoBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
        } catch {
            return jsonResponse({ error: 'Недійсний файл фотографії' }, 400);
        }
        if (!photoBytes.length || photoBytes.length > 8 * 1024 * 1024) {
            return jsonResponse({ error: 'Максимальний розмір фотографії — 8 МБ' }, 400);
        }
        if (!isImage(photoBytes, ext)) {
            return jsonResponse({ error: 'Файл не є фотографією відповідного формату' }, 400);
        }
        newPhotoKey = `${id}-${crypto.randomUUID()}.${ext}`;
        await env.memorial_photos.put(newPhotoKey, photoBytes, {
            httpMetadata: { contentType: contentTypes[ext] }
        });
        photoUrl = `/${newPhotoKey}`;
    } else if (payload.removePhoto === true) {
        photoUrl = null;
    }

    try {
        await env.memorial_db.prepare(
            `INSERT INTO memorial (id, last_name, first_name, middle_name, rank, date_of_birth, date_of_death, service_history, photo_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 last_name=excluded.last_name,
                 first_name=excluded.first_name,
                 middle_name=excluded.middle_name,
                 rank=excluded.rank,
                 date_of_birth=excluded.date_of_birth,
                 date_of_death=excluded.date_of_death,
                 service_history=excluded.service_history,
                 photo_url=excluded.photo_url`
        ).bind(...fields, photoUrl).run();
    } catch (error) {
        if (newPhotoKey) await env.memorial_photos.delete(newPhotoKey);
        throw error;
    }

    if (oldPhotoKey && oldPhotoKey !== newPhotoKey && (payload.removePhoto === true || newPhotoKey)) {
        await env.memorial_photos.delete(oldPhotoKey);
    }
    return jsonResponse({ success: true, id });
}

async function processDocument(payload, env) {
    if (!payload.rawText || !payload.id) return jsonResponse({ error: 'Missing document text or ID' }, 400);
    if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'Gemini API key is not configured' }, 500);

    const prompt = `Analyze the provided document text for a fallen service member. Extract structured metadata strictly according to the schema.
Extract the Ukrainian last name, first name, middle name, rank, birth and death dates (DD.MM.YYYY), and copy all remaining detailed service and commemorative text verbatim, preserving line breaks.
DOCUMENT TEXT:
${payload.rawText.replace(/\r\n/g, '\n')}`;
    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0,
                response_mime_type: 'application/json',
                response_schema: {
                    type: 'OBJECT',
                    properties: {
                        lastName: { type: 'STRING' },
                        firstName: { type: 'STRING' },
                        middleName: { type: 'STRING' },
                        rank: { type: 'STRING' },
                        dateOfBirth: { type: 'STRING' },
                        dateOfDeath: { type: 'STRING' },
                        serviceHistory: { type: 'STRING' }
                    },
                    required: ['lastName', 'firstName', 'middleName', 'dateOfBirth', 'dateOfDeath', 'serviceHistory']
                }
            }
        })
    });
    const aiData = await aiResponse.json();
    if (!aiResponse.ok || !aiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        return jsonResponse({ error: 'Gemini API call failed', details: aiData.error || aiData }, 500);
    }

    let parsed;
    try {
        parsed = JSON.parse(aiData.candidates[0].content.parts[0].text);
    } catch {
        return jsonResponse({ error: 'Gemini returned invalid record data' }, 500);
    }
    return saveRecord({
        id: payload.id,
        last_name: parsed.lastName,
        first_name: parsed.firstName,
        middle_name: parsed.middleName,
        rank: parsed.rank,
        date_of_birth: parsed.dateOfBirth,
        date_of_death: parsed.dateOfDeath,
        service_history: parsed.serviceHistory,
        photoBase64: payload.photoBase64,
        photoExt: payload.photoExt
    }, env);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/admin.html' || url.pathname.startsWith('/api/admin') || url.pathname === '/api/process') {
            if (!await isAuthorized(request, env)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: { 'WWW-Authenticate': 'Bearer' }
                });
            }
        }

        if (request.method === 'GET' && url.pathname === '/api/search') {
            const query = (url.searchParams.get('q') || '').trim().toLowerCase();
            let results = [];
            if (isValidQuery(query)) {
                const ftsQuery = query.split(/\s+/).map(term => `"${term}"*`).join(' ');
                const dbRes = await env.memorial_db.prepare(
                    `SELECT m.id, m.last_name, m.first_name, m.middle_name, m.rank, m.date_of_birth, m.date_of_death, m.service_history, m.photo_url
                     FROM memorial m
                     JOIN memorial_fts fts ON m.rowid = fts.rowid
                     WHERE memorial_fts MATCH ?
                     LIMIT 50`
                ).bind(ftsQuery).all();
                results = dbRes.results;
            }
            return new Response(JSON.stringify(results), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        if (url.pathname === '/api/admin/records' && request.method === 'GET') {
            const result = await env.memorial_db.prepare(
                `SELECT id, last_name, first_name, middle_name, rank, date_of_birth, date_of_death, service_history, photo_url
                 FROM memorial ORDER BY last_name, first_name`
            ).all();
            return jsonResponse(result.results || []);
        }

        if (url.pathname === '/api/admin/records' && request.method === 'POST') {
            let payload;
            try {
                payload = await request.json();
            } catch {
                return jsonResponse({ error: 'Invalid JSON' }, 400);
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                return jsonResponse({ error: 'Invalid record data' }, 400);
            }
            return saveRecord(payload, env);
        }

        if (request.method === 'POST' && url.pathname === '/api/process') {
            let payload;
            try {
                payload = await request.json();
            } catch {
                return jsonResponse({ error: 'Invalid JSON' }, 400);
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                return jsonResponse({ error: 'Invalid document data' }, 400);
            }
            return processDocument(payload, env);
        }

        if (env.ASSETS) return env.ASSETS.fetch(request);
        return new Response('Not Found', { status: 404 });
    }
};
