import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const teamDomain = 'memorial-test.cloudflareaccess.com';
const audience = 'memorial-admin-test';
const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'test-key';
let originalFetch;

function encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function accessToken() {
    const head = encode({ alg: 'RS256', kid: publicJwk.kid });
    const claims = encode({
        aud: [audience],
        iss: `https://${teamDomain}`,
        exp: Math.floor(Date.now() / 1000) + 60
    });
    const body = `${head}.${claims}`;
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keyPair.privateKey,
        new TextEncoder().encode(body)
    );
    return `${body}.${Buffer.from(signature).toString('base64url')}`;
}

function mockEnv(records = new Map()) {
    const uploadedPhotos = new Map();
    const deletedPhotos = [];
    return {
        env: {
            CF_ACCESS_TEAM_DOMAIN: teamDomain,
            CF_ACCESS_AUD: audience,
            memorial_db: {
                prepare(sql) {
                    const statement = {
                        async all() {
                            return { results: [...records.values()] };
                        },
                        bind(...values) {
                            return {
                                async first() {
                                    return records.has(values[0]) ? { photo_url: records.get(values[0]).photo_url } : null;
                                },
                                async all() {
                                    return { results: [...records.values()] };
                                },
                                async run() {
                                    records.set(values[0], {
                                        id: values[0],
                                        last_name: values[1],
                                        first_name: values[2],
                                        middle_name: values[3],
                                        rank: values[4],
                                        date_of_birth: values[5],
                                        date_of_death: values[6],
                                        service_history: values[7],
                                        photo_url: values[8]
                                    });
                                    return { success: true };
                                }
                            };
                        }
                    };
                    return statement;
                }
            },
            memorial_photos: {
                async put(key, bytes) {
                    uploadedPhotos.set(key, bytes);
                },
                async delete(key) {
                    deletedPhotos.push(key);
                    uploadedPhotos.delete(key);
                }
            },
            ASSETS: { fetch: async () => new Response('Admin page') }
        },
        records,
        uploadedPhotos,
        deletedPhotos
    };
}

before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json' }
    });
});

after(() => {
    globalThis.fetch = originalFetch;
});

test('admin page and DOCX endpoint reject requests without an Access token', async () => {
    const { env } = mockEnv();
    for (const path of ['/admin.html', '/api/process']) {
        const response = await worker.fetch(new Request(`https://memorial.test${path}`), env);
        assert.equal(response.status, 401);
    }
});

test('valid Access token can list records', async () => {
    const record = { id: 'hero', last_name: 'Test', first_name: 'Name' };
    const { env } = mockEnv(new Map([['hero', record]]));
    const token = await accessToken();
    const response = await worker.fetch(new Request('https://memorial.test/api/admin/records', {
        headers: { 'Cf-Access-Jwt-Assertion': token }
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [record]);

    const page = await worker.fetch(new Request('https://memorial.test/admin.html', {
        headers: { 'Cf-Access-Jwt-Assertion': token }
    }), env);
    assert.equal(await page.text(), 'Admin page');
});

test('manual record creation stores a photo and required fields', async () => {
    const { env, records, uploadedPhotos } = mockEnv();
    const response = await worker.fetch(new Request('https://memorial.test/api/admin/records', {
        method: 'POST',
        headers: {
            'Cf-Access-Jwt-Assertion': await accessToken(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: 'hero',
            last_name: 'Прізвище',
            first_name: 'Ім’я',
            middle_name: 'По-батькові',
            service_history: 'Історія',
            photoBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3XcAAAAASUVORK5CYII=',
            photoExt: 'png'
        })
    }), env);
    assert.equal(response.status, 200);
    assert.match(records.get('hero').photo_url, /^\/hero-[\w-]+\.png$/);
    assert.equal(uploadedPhotos.has(records.get('hero').photo_url.slice(1)), true);
});

test('manual record creation rejects missing required fields', async () => {
    const { env, records } = mockEnv();
    const response = await worker.fetch(new Request('https://memorial.test/api/admin/records', {
        method: 'POST',
        headers: {
            'Cf-Access-Jwt-Assertion': await accessToken(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: 'hero', last_name: 'Прізвище' })
    }), env);
    assert.equal(response.status, 400);
    assert.equal(records.size, 0);
});

test('removing a photo clears its URL and deletes its R2 object', async () => {
    const records = new Map([['hero', { id: 'hero', photo_url: '/hero.jpg' }]]);
    const { env, deletedPhotos } = mockEnv(records);
    const response = await worker.fetch(new Request('https://memorial.test/api/admin/records', {
        method: 'POST',
        headers: {
            'Cf-Access-Jwt-Assertion': await accessToken(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: 'hero',
            last_name: 'Прізвище',
            first_name: 'Ім’я',
            middle_name: 'По-батькові',
            service_history: 'Історія',
            removePhoto: true
        })
    }), env);
    assert.equal(response.status, 200);
    assert.equal(records.get('hero').photo_url, null);
    assert.deepEqual(deletedPhotos, ['hero.jpg']);
});
