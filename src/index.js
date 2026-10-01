export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // --- SEARCH API ---
        if (request.method === 'GET' && url.pathname === '/api/search') {
            const query = url.searchParams.get('q');
            const { results } = await env.DB.prepare(
                `SELECT id, first_name, last_name, rank, photo_url FROM memorial 
                 WHERE last_name LIKE ? OR first_name LIKE ? LIMIT 20`
            ).bind(`${query}%`, `${query}%`).all();
            
            return new Response(JSON.stringify(results), { 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

        // --- ADMIN UPLOAD API ---
        if (request.method === 'POST' && url.pathname === '/api/process') {
            const payload = await request.json();
            // payload contains { id, rawText, photoBase64, photoExt } sent from admin.html

            // 1. Send rawText to Gemini using REST (keeps Worker bundle small)
            const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Extract metadata... (Insert Prompt Here)" + payload.rawText }] }],
                    generationConfig: { temperature: 0, response_mime_type: "application/json", /* add schema here */ }
                })
            });
            const aiData = await aiResponse.json();
            const parsed = JSON.parse(aiData.candidates[0].content.parts[0].text);

            // 2. Upload Photo to R2
            const photoBuffer = Uint8Array.from(atob(payload.photoBase64), c => c.charCodeAt(0));
            const photoPath = `${payload.id}.${payload.photoExt}`;
            await env.PHOTOS.put(photoPath, photoBuffer);

            // 3. Save to D1
            await env.DB.prepare(
                `INSERT INTO memorial (id, last_name, first_name, middle_name, rank, date_of_birth, date_of_death, service_history, photo_url) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET service_history=excluded.service_history`
            ).bind(
                payload.id, parsed.lastName, parsed.firstName, parsed.middleName, parsed.rank, 
                parsed.dateOfBirth, parsed.dateOfDeath, parsed.serviceHistory, `/photos/${photoPath}`
            ).run();

            return new Response(JSON.stringify({ success: true, id: payload.id }), { status: 200 });
        }

        return new Response("Not Found", { status: 404 });
    }
}
