document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const fileCountLabel = document.getElementById('fileCountLabel');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const logList = document.getElementById('logList');

    let selectedFiles = [];

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        selectedFiles = Array.from(e.target.files).filter(f => f.name.endsWith('.docx') && !f.name.startsWith('~'));
        fileCountLabel.textContent = `Обрано файлів: ${selectedFiles.length}`;
        uploadBtn.disabled = selectedFiles.length === 0;
    });

    uploadBtn.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;

        uploadBtn.disabled = true;
        logList.innerHTML = '';
        log('INFO', `Розпочато обробку ${selectedFiles.length} файлів...`);

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const percent = Math.round(((i + 1) / selectedFiles.length) * 100);
            
            progressBar.style.width = `${percent}%`;
            progressStatus.textContent = `Обробка [${i + 1}/${selectedFiles.length}]: ${file.name}`;

            try {
                const arrayBuffer = await file.arrayBuffer();
                
                // 1. Extract raw text using Mammoth
                const textResult = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                const rawText = textResult.value;

                // 2. Extract first image using JSZip
                const zip = await JSZip.loadAsync(arrayBuffer);
                let photoBase64 = null;
                let photoExt = 'jpg';

                const mediaEntries = Object.keys(zip.files).filter(path => path.startsWith('word/media/'));
                if (mediaEntries.length > 0) {
                    const firstImageKey = mediaEntries[0];
                    photoExt = firstImageKey.split('.').pop() || 'jpg';
                    const imageBlob = await zip.files[firstImageKey].async('blob');
                    photoBase64 = await blobToBase64(imageBlob);
                }

                // Create clean ID from file name
                const recordId = file.name
                    .replace('.docx', '')
                    .replace(/\+/g, '')
                    .trim()
                    .replace(/[^a-zA-Z0-9\u0400-\u04FF]+/g, '-')
                    .toLowerCase();

                // 3. POST extracted payload to Cloudflare Worker
                const response = await fetch('/api/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: recordId,
                        rawText: rawText,
                        photoBase64: photoBase64,
                        photoExt: photoExt
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error ${response.status}`);
                }

                log('SUCCESS', `[${i + 1}/${selectedFiles.length}] Успішно збережено: ${file.name}`);
            } catch (err) {
                log('ERROR', `[${i + 1}/${selectedFiles.length}] Помилка обробки ${file.name}: ${err.message}`);
            }

            // Short pause between network requests
            await new Promise(r => setTimeout(r, 1000));
        }

        progressStatus.textContent = 'Обробка завершена!';
        uploadBtn.disabled = false;
    });

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    function log(type, message) {
        const div = document.createElement('div');
        div.className = `log-entry ${type === 'SUCCESS' ? 'log-success' : type === 'ERROR' ? 'log-error' : ''}`;
        div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logList.appendChild(div);
        logList.scrollTop = logList.scrollHeight;
    }
});
