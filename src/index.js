function isValidQuery(query) {
    return query && query.length >= 5 && query.split(' ').length >= 3;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // --- SEARCH API ---
       if (request.method === 'GET' && url.pathname === '/api/search') {
            const rawQuery = url.searchParams.get('q') || '';
            const query = rawQuery.trim().toLowerCase();

            let results;

            if (!isValidQuery(query)) {
                results = [];
            } else {
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

            return new Response(JSON.stringify(results || []), { 
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*' 
                } 
            });
        }

        // --- ADMIN UPLOAD API ---
        if (request.method === 'POST' && url.pathname === '/api/process') {
            const payload = await request.json();

            if (!payload.rawText) {
                return new Response(JSON.stringify({ error: "Missing document text" }), { status: 400 });
            }

            // Normalize Windows CRLF line breaks to standard LF
            const cleanRawText = payload.rawText.replace(/\r\n/g, '\n');

            const prompt = `
            Analyze the provided document text for a fallen service member.
            Extract structured metadata strictly according to the schema.

            CRITICAL INSTRUCTIONS:
            1. Ukrainian names follow the standard 3-part naming structure (Прізвище, Ім'я, По батькові). Extract all three:
            - lastName (Прізвище)
            - firstName (Ім'я)
            - middleName (По батькові / Patronymic)
            2. Extract dates of birth and death (formatted DD.MM.YYYY).
            3. Extract rank if present (e.g., "головний сержант").
            4. For 'serviceHistory', copy ALL remaining detailed text, military unit descriptions, combat actions, and commemorative sentences VERBATIM.
            - LINE BREAKS REQUIREMENT: Preserve ALL original line breaks and paragraph separations using literal \\n characters inside the JSON string.
            - Do NOT collapse paragraphs or consecutive lines into a single continuous block of text.

            DOCUMENT TEXT:
            ${cleanRawText}
            `;
            // 1. Call Gemini REST API
            const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0,
                        response_mime_type: "application/json",
                        response_schema: {
                            type: "OBJECT",
                            properties: {
                                lastName: { type: "STRING" },
                                firstName: { type: "STRING" },
                                middleName: { type: "STRING" },
                                rank: { type: "STRING" },
                                dateOfBirth: { type: "STRING" },
                                dateOfDeath: { type: "STRING" },
                                serviceHistory: { type: "STRING" }
                            },
                            required: ["lastName", "firstName", "middleName", "dateOfBirth", "dateOfDeath", "serviceHistory"]
                        }
                    }
                })
            });

            const aiData = await aiResponse.json();

            // Catch Gemini API errors gracefully
            if (!aiResponse.ok || !aiData.candidates) {
                console.error("Gemini API Error details:", JSON.stringify(aiData));
                return new Response(JSON.stringify({ 
                    error: "Gemini API call failed", 
                    details: aiData.error || aiData 
                }), { status: 500 });
            }

            const parsed = JSON.parse(aiData.candidates[0].content.parts[0].text);

            // 2. Upload Photo to R2 (if photo exists)
            let photoUrl = null;
            if (payload.photoBase64) {
                const photoBuffer = Uint8Array.from(atob(payload.photoBase64), c => c.charCodeAt(0));
                const photoPath = `${payload.id}.${payload.photoExt || 'jpg'}`;
                await env.memorial_photos.put(photoPath, photoBuffer);
                photoUrl = `/${photoPath}`;
            }

            // 3. Save Record to D1 Database
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
            ).bind(
                payload.id, 
                parsed.lastName, 
                parsed.firstName, 
                parsed.middleName, 
                parsed.rank || '', 
                parsed.dateOfBirth, 
                parsed.dateOfDeath, 
                parsed.serviceHistory, 
                photoUrl
            ).run();

            return new Response(JSON.stringify({ success: true, id: payload.id }), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response("Not Found", { status: 404 });
    }
}
