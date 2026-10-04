// Queue State Management
let batchQueue = [];
let memorialRecords = [];
const PHOTO_BASE_URL = 'https://pub-5339af3e484f4c5a88f519fc7ee86c93.r2.dev';

document.addEventListener('DOMContentLoaded', () => {
    setupRecordEditor();
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const processAllBtn = document.getElementById('process-all-btn');
    const clearQueueBtn = document.getElementById('clear-queue-btn');

    // File selection via button
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    // Drag-and-Drop setup
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) {
                handleFiles(Array.from(e.dataTransfer.files));
            }
        });
    }

    if (clearQueueBtn) {
        clearQueueBtn.addEventListener('click', () => {
            batchQueue = [];
            renderBatchQueue();
        });
    }

    if (processAllBtn) {
        processAllBtn.addEventListener('click', processAll);
    }
});

function setupRecordEditor() {
    const form = document.getElementById('record-form');
    if (!form) return;

    const select = document.getElementById('record-select');
    const photoInput = document.getElementById('record-photo');
    const removePhoto = document.getElementById('remove-photo');

    document.getElementById('new-record-btn').addEventListener('click', () => showRecord(null));
    select.addEventListener('change', () => {
        showRecord(memorialRecords.find(record => record.id === select.value) || null);
    });
    photoInput.addEventListener('change', () => {
        if (photoInput.files.length) removePhoto.checked = false;
    });
    removePhoto.addEventListener('change', () => {
        if (removePhoto.checked) photoInput.value = '';
    });
    form.addEventListener('submit', saveEditedRecord);
    loadRecords();
}

async function loadRecords(selectedId = '') {
    const select = document.getElementById('record-select');
    const status = document.getElementById('editor-status');
    try {
        const response = await fetch('/api/admin/records');
        if (!response.ok) throw new Error(response.status === 401 ? 'Немає доступу до панелі адміністратора' : 'Не вдалося завантажити записи');
        memorialRecords = await response.json();
        select.replaceChildren(new Option('Оберіть запис', ''));
        memorialRecords.forEach(record => {
            const name = [record.last_name, record.first_name, record.middle_name].filter(Boolean).join(' ');
            select.add(new Option(`${name} (${record.id})`, record.id));
        });
        if (selectedId && memorialRecords.some(record => record.id === selectedId)) {
            select.value = selectedId;
            showRecord(memorialRecords.find(record => record.id === selectedId));
        } else if (!selectedId) {
            select.value = '';
        }
        status.textContent = '';
        status.classList.remove('error');
    } catch (error) {
        status.textContent = error.message;
        status.classList.add('error');
    }
}

function showRecord(record) {
    const form = document.getElementById('record-form');
    form.reset();
    document.getElementById('editor-status').textContent = '';
    document.getElementById('editor-status').classList.remove('error');
    const fields = ['id', 'last_name', 'first_name', 'middle_name', 'rank', 'date_of_birth', 'date_of_death', 'service_history'];
    fields.forEach(field => {
        form.elements[field].value = record?.[field] || '';
    });
    form.elements.id.readOnly = Boolean(record);
    document.getElementById('record-photo-preview').hidden = !record?.photo_url;
    if (record?.photo_url) {
        document.getElementById('record-photo-preview').src = `${PHOTO_BASE_URL}${record.photo_url}`;
    } else {
        document.getElementById('record-photo-preview').removeAttribute('src');
    }
    document.getElementById('record-select').value = record?.id || '';
}

async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

async function saveEditedRecord(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('editor-status');
    const saveButton = document.getElementById('save-record-btn');
    const payload = Object.fromEntries(
        ['id', 'last_name', 'first_name', 'middle_name', 'rank', 'date_of_birth', 'date_of_death', 'service_history']
            .map(field => [field, form.elements[field].value])
    );
    const photo = document.getElementById('record-photo').files[0];
    if (photo) {
        if (photo.size > 8 * 1024 * 1024) {
            status.textContent = 'Максимальний розмір фотографії — 8 МБ';
            status.classList.add('error');
            return;
        }
        const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        if (!extensions[photo.type]) {
            status.textContent = 'Підтримуються лише JPG, PNG та WebP';
            status.classList.add('error');
            return;
        }
        payload.photoBase64 = await fileToBase64(photo);
        payload.photoExt = extensions[photo.type];
    }
    payload.removePhoto = document.getElementById('remove-photo').checked;
    saveButton.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Збереження…';
    try {
        const response = await fetch('/api/admin/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не вдалося зберегти запис');
        await loadRecords(result.id);
        status.textContent = 'Запис збережено';
    } catch (error) {
        status.textContent = error.message;
        status.classList.add('error');
    } finally {
        saveButton.disabled = false;
    }
}

/**
 * Handle incoming files from input or drop zone
 */
async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    await handleFiles(files);
    e.target.value = ''; // Reset input to allow re-selecting same file if needed
}

async function handleFiles(files) {
    const docxFiles = files.filter(f => f.name.endsWith('.docx'));
    if (!docxFiles.length) return;

    for (const file of docxFiles) {
        try {
            const parsed = await extractDocxContent(file);
            batchQueue.push({
                ...parsed,
                status: 'pending',
                errorDetails: null
            });
        } catch (err) {
            console.error('Failed to parse .docx file:', file.name, err);
            batchQueue.push({
                id: file.name.replace(/\.[^/.]+$/, ""),
                fileName: file.name,
                rawText: '',
                images: [],
                selectedImageIndex: null,
                status: 'error',
                errorDetails: 'Помилка зчитування .docx файлу'
            });
        }
    }
    renderBatchQueue();
}

/**
 * Extract raw text (Mammoth) and images (JSZip) from a .docx file
 */
async function extractDocxContent(file) {
    const arrayBuffer = await file.arrayBuffer();

    // 1. Extract raw text using Mammoth
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const rawText = textResult.value || '';

    // 2. Extract embedded media files using JSZip
    const zip = await JSZip.loadAsync(arrayBuffer);
    const mediaFiles = Object.keys(zip.files).filter(name => 
        name.startsWith('word/media/') && !zip.files[name].dir
    );

    const images = [];
    for (const fileName of mediaFiles) {
        const fileObj = zip.files[fileName];
        const base64 = await fileObj.async('base64');
        const blob = await fileObj.async('blob');
        const ext = fileName.split('.').pop().toLowerCase() || 'jpg';

        images.push({
            name: fileName,
            ext: ext,
            base64: base64,
            size: blob.size,
            dataUrl: `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${base64}`
        });
    }

    // Sort images by byte size descending (largest image set as smart default)
    images.sort((a, b) => b.size - a.size);

    return {
        id: file.name.replace(/\.[^/.]+$/, ""),
        fileName: file.name,
        rawText,
        images,
        selectedImageIndex: images.length > 0 ? 0 : null
    };
}

/**
 * Render all queued items into the UI
 */
function renderBatchQueue() {
    const queueContainer = document.getElementById('queue-container');
    const processAllBtn = document.getElementById('process-all-btn');

    if (!queueContainer) return;

    if (batchQueue.length === 0) {
        queueContainer.innerHTML = `<div class="empty-queue">Черга порожня. Перетягніть .docx файли для початку.</div>`;
        if (processAllBtn) processAllBtn.disabled = true;
        return;
    }

    if (processAllBtn) {
        const hasPending = batchQueue.some(item => item.status === 'pending' || item.status === 'error');
        processAllBtn.disabled = !hasPending;
    }

    queueContainer.innerHTML = '';
    batchQueue.forEach((item, index) => {
        const card = renderBatchItem(item, index);
        queueContainer.appendChild(card);
    });
}

/**
 * Render single queue card
 */
function renderBatchItem(item, index) {
    const container = document.createElement('div');
    container.className = `batch-item-card status-${item.status}`;

    let photoHtml = '';
    
    if (item.images.length === 0) {
        photoHtml = `<div class="no-photo-badge">Без фотографії</div>`;
    } else if (item.images.length === 1) {
        photoHtml = `
            <div class="single-photo-preview">
                <img src="${item.images[0].dataUrl}" alt="Photo preview" />
                <span class="file-size">${(item.images[0].size / 1024).toFixed(1)} KB</span>
            </div>`;
    } else {
        // Multi-image selector
        photoHtml = `
            <div class="multi-photo-picker">
                <p class="picker-label">Знайдено зображень: ${item.images.length}. Оберіть портрет:</p>
                <div class="thumbnails-grid">
                    ${item.images.map((img, imgIdx) => `
                        <div class="thumb-wrapper ${imgIdx === item.selectedImageIndex ? 'active' : ''}" 
                             onclick="window.selectImageForFile(${index},${imgIdx})">
                            <img src="${img.dataUrl}" alt="Thumbnail ${imgIdx + 1}" />
                            <span class="file-size">${(img.size / 1024).toFixed(1)} KB</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    const statusLabels = {
        pending: 'Очікує',
        processing: 'Обробка...',
        completed: 'Успішно',
        error: 'Помилка'
    };

    container.innerHTML = `
        <div class="item-header">
            <div class="item-title">
                <strong>${item.id}</strong>
                <span class="filename">${item.fileName}</span>
            </div>
            <span class="status-badge status-${item.status}">${statusLabels[item.status] || item.status}</span>
        </div>
        
        ${photoHtml}

        ${item.errorDetails ? `<div class="error-text">${item.errorDetails}</div>` : ''}

        <div class="item-actions">
            ${item.status === 'pending' || item.status === 'error' ? `
                <button class="btn-primary" onclick="window.processSingleItem(${index})">
                    ${item.status === 'error' ? 'Повторити' : 'Обробити'}
                </button>
            ` : ''}
            <button class="btn-danger" onclick="window.removeQueueItem(${index})">Видалити</button>
        </div>
    `;

    return container;
}

/**
 * Global handlers attached to window for inline HTML onclick binding
 */
window.selectImageForFile = function(itemIndex, imageIndex) {
    if (batchQueue[itemIndex] && batchQueue[itemIndex].status === 'pending') {
        batchQueue[itemIndex].selectedImageIndex = imageIndex;
        renderBatchQueue();
    }
};

window.removeQueueItem = function(index) {
    batchQueue.splice(index, 1);
    renderBatchQueue();
};

window.processSingleItem = async function(index) {
    const item = batchQueue[index];
    if (!item) return;

    item.status = 'processing';
    item.errorDetails = null;
    renderBatchQueue();

    const selectedPhoto = (item.selectedImageIndex !== null && item.images[item.selectedImageIndex]) 
        ? item.images[item.selectedImageIndex] 
        : null;

    const payload = {
        id: generateCleanId(item.id),
        rawText: item.rawText,
        photoBase64: selectedPhoto ? selectedPhoto.base64 : null,
        photoExt: selectedPhoto ? selectedPhoto.ext : 'jpg'
    };

    try {
        const response = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const resData = await response.json();

        if (response.ok && resData.success) {
            item.status = 'completed';
        } else {
            item.status = 'error';
            item.errorDetails = resData.error || resData.details || 'Помилка збереження запису';
        }
    } catch (err) {
        console.error('API Process Error:', err);
        item.status = 'error';
        item.errorDetails = 'Мережева помилка відправки';
    }

    renderBatchQueue();
};

/**
 * Process all pending or failed items sequentially
 */
async function processAll() {
    const processAllBtn = document.getElementById('process-all-btn');
    if (processAllBtn) processAllBtn.disabled = true;

    for (let i = 0; i < batchQueue.length; i++) {
        if (batchQueue[i].status === 'pending' || batchQueue[i].status === 'error') {
            await window.processSingleItem(i);
        }
    }

    if (processAllBtn) processAllBtn.disabled = false;
}

/**
 * Generates a clean, URL-safe ID from a filename
 */
function generateCleanId(fileName) {
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    return nameWithoutExt
        .trim()
        .replace(/\s+/g, '_')                           // Replace spaces with underscores
        .replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '');  // Retain Cyrillic, Latin, numbers, hyphens, and underscores
}
