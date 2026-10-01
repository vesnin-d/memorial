/**
 * Standalone Memorial Search Component
 * Prepped for extraction to external company websites.
 */
(function () {
    // Update this URL when embedding on an external company website
    const CONFIG = {
        apiBaseUrl: window.location.origin // e.g. 'https://memorial-backend.yourcompany.workers.dev'
    };

    let searchDebounceTimer = null;
    let cachedResults = [];

    // DOM Element References
    const searchInput = document.getElementById('searchInput');
    const resultsList = document.getElementById('resultsList');
    const emptyMessage = document.getElementById('emptyMessage');
    const memorialModal = document.getElementById('memorialModal');
    const modalClose = document.getElementById('modalClose');
    const modalBody = document.getElementById('modalBody');

    // Initialize Event Listeners
    function init() {
        if (searchInput) {
            searchInput.addEventListener('input', (e) => handleSearchInput(e.target.value.trim()));
        }

        if (modalClose) {
            modalClose.addEventListener('click', closeModal);
        }

        if (memorialModal) {
            memorialModal.addEventListener('click', (e) => {
                if (e.target === memorialModal) closeModal();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && memorialModal.classList.contains('active')) {
                closeModal();
            }
        });

        // Trigger initial search to display default records
        fetchMemorialData('');
    }

    function handleSearchInput(query) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            fetchMemorialData(query);
        }, 300); // 300ms debounce
    }

    async function fetchMemorialData(query) {
        try {
            const url = new URL(`${CONFIG.apiBaseUrl}/api/search`);
            if (query) url.searchParams.set('q', query);

            const response = await fetch(url.toString());
            if (!response.ok) throw new Error('Search request failed');

            cachedResults = await response.json();
            renderResults(cachedResults);
        } catch (err) {
            console.error('Error querying memorial database:', err);
        }
    }

    function renderResults(records) {
        resultsList.innerHTML = '';

        if (!records || records.length === 0) {
            emptyMessage.classList.remove('hidden');
            return;
        }

        emptyMessage.classList.add('hidden');

        records.forEach(record => {
            const card = document.createElement('div');
            card.className = 'card';
            
            const fullName = `${record.last_name} ${record.first_name} ${record.middle_name || ''}`.trim();
            const photoSrc = ('https://pub-5339af3e484f4c5a88f519fc7ee86c93.r2.dev' + record.photo_url) || 'https://via.placeholder.com/300x400?text=No+Photo';

            card.innerHTML = `
                <img src="${photoSrc}" alt="${fullName}" class="card-photo" loading="lazy">
                <div class="card-body">
                    <h2 class="card-title">${fullName}</h2>
                    <div class="card-rank">${record.rank || 'Військовослужбовець'}</div>
                </div>
            `;

            card.addEventListener('click', () => openModal(record));
            resultsList.appendChild(card);
        });
    }

    function openModal(record) {
        const fullName = `${record.last_name} ${record.first_name} ${record.middle_name || ''}`.trim();
        const photoSrc = record.photo_url || 'https://via.placeholder.com/300x400?text=No+Photo';

        modalBody.innerHTML = `
            <div class="memorial-profile">
                <div>
                    <img src="${photoSrc}" alt="${fullName}" class="profile-photo">
                    <div class="profile-dates">
                        ${record.date_of_birth || '?'} — ${record.date_of_death || '?'}
                    </div>
                </div>
                <div>
                    <h2 style="margin-top:0">${fullName}</h2>
                    <p style="color: var(--muted); font-weight: 500;">${record.rank || ''}</p>
                    <hr style="border: 0; border-top: 1px solid var(--border); margin: 1rem 0;">
                    <div class="profile-history">${record.service_history || 'Інформація відсутня.'}</div>
                </div>
            </div>
        `;

        memorialModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    function closeModal() {
        memorialModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    // Auto-run initialization
    document.addEventListener('DOMContentLoaded', init);
})();
