import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const PHOTO_BASE_URL = 'https://pub-5339af3e484f4c5a88f519fc7ee86c93.r2.dev';
const EMPTY_RECORD = {
    id: '',
    last_name: '',
    first_name: '',
    middle_name: '',
    rank: '',
    date_of_birth: '',
    date_of_death: '',
    service_history: ''
};
const FIELDS = [
    ['id', 'ID запису', true],
    ['rank', 'Звання'],
    ['last_name', 'Прізвище', true],
    ['first_name', 'Ім’я', true],
    ['middle_name', 'По батькові', true],
    ['date_of_birth', 'Дата народження'],
    ['date_of_death', 'Дата загибелі'],
    ['service_history', 'Історія служби', true]
];
const PHOTO_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function EditorField({ name, label, required, value, onChange, disabled }) {
    const commonProps = {
        id: `record-${name}`,
        name,
        required,
        value: value || '',
        onChange: event => onChange(name, event.target.value),
        readOnly: disabled
    };

    return (
        <label className={`editor-field${name === 'service_history' ? ' full-width' : ''}`}>
            <span>{label}</span>
            {name === 'service_history'
                ? <textarea {...commonProps} />
                : <input {...commonProps} maxLength={name === 'id' ? 100 : undefined} />}
        </label>
    );
}

function RecordEditor() {
    const [records, setRecords] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [values, setValues] = useState(EMPTY_RECORD);
    const [photo, setPhoto] = useState(null);
    const [removePhoto, setRemovePhoto] = useState(false);
    const [status, setStatus] = useState({ message: '', error: false });
    const [saving, setSaving] = useState(false);
    const selectedRecord = records.find(record => record.id === selectedId);
    const [photoPreview, setPhotoPreview] = useState('');

    useEffect(() => {
        if (!photo) {
            setPhotoPreview('');
            return undefined;
        }
        const url = URL.createObjectURL(photo);
        setPhotoPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [photo]);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/admin/records')
            .then(response => {
                if (!response.ok) {
                    throw new Error(response.status === 401
                        ? 'Немає доступу до панелі адміністратора'
                        : 'Не вдалося завантажити записи');
                }
                return response.json();
            })
            .then(items => {
                if (!cancelled) setRecords(items);
            })
            .catch(error => {
                if (!cancelled) setStatus({ message: error.message, error: true });
            });
        return () => { cancelled = true; };
    }, []);

    function selectRecord(id) {
        const record = records.find(item => item.id === id);
        setSelectedId(id);
        setValues(record ? { ...EMPTY_RECORD, ...record } : EMPTY_RECORD);
        setPhoto(null);
        setRemovePhoto(false);
        setStatus({ message: '', error: false });
    }

    function changeField(name, value) {
        setValues(current => ({ ...current, [name]: value }));
    }

    async function saveRecord(event) {
        event.preventDefault();
        if (photo && (!PHOTO_EXTENSIONS[photo.type] || photo.size > 8 * 1024 * 1024)) {
            setStatus({
                message: photo.size > 8 * 1024 * 1024
                    ? 'Максимальний розмір фотографії — 8 МБ'
                    : 'Підтримуються лише JPG, PNG та WebP',
                error: true
            });
            return;
        }

        setSaving(true);
        setStatus({ message: 'Збереження…', error: false });
        try {
            const payload = { ...values, removePhoto };
            if (photo) {
                payload.photoBase64 = await fileToBase64(photo);
                payload.photoExt = PHOTO_EXTENSIONS[photo.type];
            }
            const response = await fetch('/api/admin/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Не вдалося зберегти запис');

            const listResponse = await fetch('/api/admin/records');
            if (!listResponse.ok) throw new Error('Запис збережено, але список не оновився');
            const updatedRecords = await listResponse.json();
            const savedRecord = updatedRecords.find(record => record.id === result.id);
            setRecords(updatedRecords);
            setSelectedId(result.id);
            if (savedRecord) setValues({ ...EMPTY_RECORD, ...savedRecord });
            setPhoto(null);
            setRemovePhoto(false);
            setStatus({ message: 'Запис збережено', error: false });
        } catch (error) {
            setStatus({ message: error.message, error: true });
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="editor-section">
            <h2>Редагування записів</h2>
            <p className="subtitle">Оберіть наявний запис або створіть новий. Фотографію можна замінити чи видалити.</p>
            <div className="editor-toolbar">
                <label className="editor-field">
                    <span>Запис</span>
                    <select value={selectedId} onChange={event => selectRecord(event.target.value)}>
                        <option value="">Оберіть запис</option>
                        {records.map(record => (
                            <option key={record.id} value={record.id}>
                                {[record.last_name, record.first_name, record.middle_name].filter(Boolean).join(' ')} ({record.id})
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => selectRecord('')}
                >
                    Новий запис
                </button>
            </div>
            <form onSubmit={saveRecord}>
                <div className="editor-grid">
                    {FIELDS.map(([name, label, required]) => (
                        <EditorField
                            key={name}
                            name={name}
                            label={label}
                            required={required}
                            value={values[name]}
                            onChange={changeField}
                            disabled={name === 'id' && Boolean(selectedRecord)}
                        />
                    ))}
                    <label className="editor-field full-width">
                        <span>Нова фотографія</span>
                        <input
                            key={selectedId || 'new-record'}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={event => {
                                setPhoto(event.target.files[0] || null);
                                setRemovePhoto(false);
                            }}
                        />
                    </label>
                    <label className="editor-field full-width">
                        <span>
                            <input
                                type="checkbox"
                                checked={removePhoto}
                                onChange={event => {
                                    setRemovePhoto(event.target.checked);
                                    if (event.target.checked) setPhoto(null);
                                }}
                            /> Видалити поточну фотографію
                        </span>
                        {(photoPreview || (!removePhoto && selectedRecord?.photo_url)) && (
                            <img
                                className="editor-photo-preview"
                                src={photoPreview || `${PHOTO_BASE_URL}${selectedRecord.photo_url}`}
                                alt="Поточна фотографія"
                            />
                        )}
                    </label>
                </div>
                <button className="btn-primary" type="submit" disabled={saving}>
                    {saving ? 'Збереження…' : 'Зберегти запис'}
                </button>
                <p className={`editor-status${status.error ? ' error' : ''}`} role="status">
                    {status.message}
                </p>
            </form>
        </section>
    );
}

async function extractDocxContent(file) {
    const arrayBuffer = await file.arrayBuffer();
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const zip = await JSZip.loadAsync(arrayBuffer);
    const mediaFiles = Object.keys(zip.files).filter(name =>
        name.startsWith('word/media/') && !zip.files[name].dir
    );
    const images = [];
    for (const name of mediaFiles) {
        const media = zip.files[name];
        const base64 = await media.async('base64');
        const blob = await media.async('blob');
        const ext = name.split('.').pop().toLowerCase() || 'jpg';
        images.push({
            name,
            ext,
            base64,
            size: blob.size,
            dataUrl: `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${base64}`
        });
    }
    images.sort((first, second) => second.size - first.size);
    return {
        id: file.name.replace(/\.[^/.]+$/, ''),
        fileName: file.name,
        rawText: textResult.value || '',
        images,
        selectedImageIndex: images.length ? 0 : null
    };
}

function cleanId(fileName) {
    return fileName.replace(/\.[^/.]+$/, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_\u0400-\u04FF-]/g, '');
}

function UploadQueue() {
    const [queue, setQueue] = useState([]);
    const [dragOver, setDragOver] = useState(false);
    const [processingKey, setProcessingKey] = useState('');
    const [processingAll, setProcessingAll] = useState(false);
    const fileInput = React.useRef(null);
    const hasPending = queue.some(item => item.status === 'pending' || item.status === 'error');

    async function addFiles(files) {
        for (const file of files.filter(item => item.name.toLowerCase().endsWith('.docx'))) {
            try {
                const parsed = await extractDocxContent(file);
                setQueue(current => [...current, {
                    ...parsed,
                    queueKey: crypto.randomUUID(),
                    status: 'pending',
                    errorDetails: ''
                }]);
            } catch (error) {
                console.error('Failed to parse .docx file:', file.name, error);
                setQueue(current => [...current, {
                    id: file.name.replace(/\.[^/.]+$/, ''),
                    fileName: file.name,
                    rawText: '',
                    images: [],
                    selectedImageIndex: null,
                    queueKey: crypto.randomUUID(),
                    status: 'error',
                    errorDetails: 'Помилка зчитування .docx файлу'
                }]);
            }
        }
    }

    async function processItem(item) {
        setProcessingKey(item.queueKey);
        setQueue(current => current.map(entry => entry.queueKey === item.queueKey
            ? { ...entry, status: 'processing', errorDetails: '' }
            : entry));
        const selectedPhoto = item.images[item.selectedImageIndex] || null;
        try {
            const response = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: cleanId(item.id),
                    rawText: item.rawText,
                    photoBase64: selectedPhoto?.base64 || null,
                    photoExt: selectedPhoto?.ext || 'jpg'
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || result.details || 'Помилка збереження запису');
            }
            setQueue(current => current.map(entry => entry.queueKey === item.queueKey
                ? { ...entry, status: 'completed' }
                : entry));
        } catch (error) {
            setQueue(current => current.map(entry => entry.queueKey === item.queueKey
                ? { ...entry, status: 'error', errorDetails: error.message || 'Мережева помилка відправки' }
                : entry));
        } finally {
            setProcessingKey('');
        }
    }

    async function processAll() {
        setProcessingAll(true);
        const pending = queue.filter(item => item.status === 'pending' || item.status === 'error');
        for (const item of pending) await processItem(item);
        setProcessingAll(false);
    }

    function chooseImage(queueKey, imageIndex) {
        setQueue(current => current.map(item => item.queueKey === queueKey
            ? { ...item, selectedImageIndex: imageIndex }
            : item));
    }

    const statusLabels = {
        pending: 'Очікує',
        processing: 'Обробка...',
        completed: 'Успішно',
        error: 'Помилка'
    };

    return (
        <section>
            <h2>Завантаження документів (.docx)</h2>
            <p className="subtitle">
                Виберіть один або декілька `.docx` файлів. Браузер розархівує зображення і текст локально та передасть дані на сервер.
            </p>
            <div
                className={`dropzone${dragOver ? ' drag-over' : ''}`}
                role="button"
                tabIndex="0"
                onClick={() => fileInput.current.click()}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') fileInput.current.click();
                }}
                onDragOver={event => {
                    event.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={event => {
                    event.preventDefault();
                    setDragOver(false);
                    addFiles(Array.from(event.dataTransfer.files));
                }}
            >
                <p>Натисніть або перетягніть .docx файли сюди</p>
                <span>Підтримується пакетне завантаження кількох файлів</span>
                <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept=".docx"
                    onChange={event => {
                        addFiles(Array.from(event.target.files));
                        event.target.value = '';
                    }}
                />
            </div>
            <div className="controls-bar">
                <button
                    className="btn-primary"
                    type="button"
                    disabled={!hasPending || processingAll || Boolean(processingKey)}
                    onClick={processAll}
                >
                    Обробити всі
                </button>
                <button
                    className="btn-secondary"
                    type="button"
                    disabled={processingAll || Boolean(processingKey)}
                    onClick={() => setQueue([])}
                >
                    Очистити чергу
                </button>
            </div>
            <div className="queue-container">
                {queue.length === 0
                    ? <div className="empty-queue">Черга порожня. Перетягніть .docx файли для початку.</div>
                    : queue.map(item => (
                        <div className={`batch-item-card status-${item.status}`} key={item.queueKey}>
                            <div className="item-header">
                                <div className="item-title">
                                    <strong>{item.id}</strong>
                                    <span className="filename">{item.fileName}</span>
                                </div>
                                <span className={`status-badge status-${item.status}`}>
                                    {statusLabels[item.status]}
                                </span>
                            </div>
                            {item.images.length === 0
                                ? <div className="no-photo-badge">Без фотографії</div>
                                : item.images.length === 1
                                    ? <div className="single-photo-preview">
                                        <img src={item.images[0].dataUrl} alt="Попередній перегляд фото" />
                                        <span className="file-size">{(item.images[0].size / 1024).toFixed(1)} KB</span>
                                    </div>
                                    : <div className="multi-photo-picker">
                                        <p className="picker-label">Знайдено зображень: {item.images.length}. Оберіть портрет:</p>
                                        <div className="thumbnails-grid">
                                            {item.images.map((image, imageIndex) => (
                                                <button
                                                    className={`thumb-wrapper${imageIndex === item.selectedImageIndex ? ' active' : ''}`}
                                                    type="button"
                                                    key={image.name}
                                                    onClick={() => chooseImage(item.queueKey, imageIndex)}
                                                >
                                                    <img src={image.dataUrl} alt={`Thumbnail ${imageIndex + 1}`} />
                                                    <span className="file-size">{(image.size / 1024).toFixed(1)} KB</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>}
                            {item.errorDetails && <div className="error-text">{item.errorDetails}</div>}
                            <div className="item-actions">
                                {(item.status === 'pending' || item.status === 'error') && (
                                    <button
                                        className="btn-primary"
                                        type="button"
                                        disabled={Boolean(processingKey) || processingAll}
                                        onClick={() => processItem(item)}
                                    >
                                        {item.status === 'error' ? 'Повторити' : 'Обробити'}
                                    </button>
                                )}
                                <button
                                    className="btn-danger"
                                    type="button"
                                    disabled={Boolean(processingKey) || processingAll}
                                    onClick={() => setQueue(current => current.filter(entry => entry.queueKey !== item.queueKey))}
                                >
                                    Видалити
                                </button>
                            </div>
                        </div>
                    ))}
            </div>
        </section>
    );
}

function AdminApp() {
    return (
        <>
            <RecordEditor />
            <UploadQueue />
        </>
    );
}

createRoot(document.getElementById('record-editor-root')).render(<AdminApp />);
