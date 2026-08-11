const CDN_ACCELERATOR_BASES = [
    'https://cdn.jsdelivr.net/gh/Kato-Shoko705/Phoebe-Hub@main',
    'https://kato-shoko705.github.io/Phoebe-Hub',
    'https://raw.githubusercontent.com/Kato-Shoko705/Phoebe-Hub/main'
];
const CDN_ACCELERATOR_JSON_PATH = 'data/memes.json';

function cdnNormalizeRepoPath(path) {
    return String(path || '').replace(/^\/+/, '');
}

function cdnBuildRepoAssetUrls(url) {
    if (!url) return [];
    if (/^https?:\/\//i.test(url)) return [url];

    const normalizedPath = cdnNormalizeRepoPath(url);
    return CDN_ACCELERATOR_BASES.map(base => `${base}/${normalizedPath}`);
}

function getMemeAssetUrls(meme) {
    if (!meme) return [];
    const urls = [meme.url, ...(meme.fallbackUrls || [])].filter(Boolean);
    return [...new Set(urls)];
}

async function fetchWithFallback(urls, options = {}) {
    let lastError = null;

    for (const url of urls) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return { response, url };
            }
            lastError = new Error(`Request failed: ${response.status} ${response.statusText}`);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('All asset requests failed');
}

function encodeFallbackUrls(urls) {
    return encodeURIComponent(JSON.stringify(urls || []));
}

function decodeFallbackUrls(value) {
    if (!value) return [];
    try {
        return JSON.parse(decodeURIComponent(value));
    } catch (error) {
        console.warn('Failed to decode fallback URLs:', error);
        return [];
    }
}

function handleImageLoadError(img) {
    const fallbackUrls = decodeFallbackUrls(img.dataset.fallbacks);
    const nextUrl = fallbackUrls.shift();

    if (nextUrl) {
        img.dataset.fallbacks = encodeFallbackUrls(fallbackUrls);
        img.dataset.full = nextUrl;
        img.src = nextUrl;
        return;
    }

    img.onerror = null;
    img.src = `https://via.placeholder.com/300x300/B794F6/FFFFFF?text=${encodeURIComponent(img.alt || 'Phoebe')}`;
}

async function loadData() {
    try {
        const { response, url: resolvedJsonUrl } = await fetchWithFallback(
            cdnBuildRepoAssetUrls(CDN_ACCELERATOR_JSON_PATH),
            { cache: 'force-cache' }
        );
        const data = await response.json();
        memesData = (data.memes || []).map((m, idx) => {
            const assetUrls = cdnBuildRepoAssetUrls(m.url);
            return {
                id: m.id || idx + 1,
                title: m.title || 'Untitled',
                url: assetUrls[0] || '',
                fallbackUrls: assetUrls.slice(1),
                category: m.category || ['cute'],
                views: m.views || 0,
                downloads: m.downloads || 0,
                date: m.date || new Date().toISOString().split('T')[0],
                isGif: m.isGif || false,
                hot: m.hot || 0,
                tags: m.tags || []
            };
        });
        dataLoaded = true;
        console.log('memes.json loaded from:', resolvedJsonUrl);
        console.log(`Loaded ${memesData.length} memes`);
    } catch (error) {
        console.error('Failed to load meme data:', error);
        useLocalFallback();
        showLoadError();
    }

    renderMemes();
    updateHotList();
}

function renderMemes() {
    const grid = document.getElementById('memeGrid');
    if (!grid) return;

    let filtered = [...memesData];

    if (currentCategory !== 'all') {
        if (currentCategory === 'static') {
            filtered = filtered.filter(m => !m.isGif);
        } else if (currentCategory === 'gif') {
            filtered = filtered.filter(m => m.isGif);
        } else if (currentCategory === 'featured' || currentCategory === 'recommended') {
            filtered = filtered.filter(m => {
                const tags = m.tags || [];
                return tags.includes(currentCategory);
            });
        } else {
            filtered = filtered.filter(m => {
                const cats = m.category || [];
                return cats.includes(currentCategory);
            });
        }
    }

    if (searchQuery) {
        filtered = filtered.filter(m => m.title && m.title.includes(searchQuery));
    }

    if (currentSort === 'newest') {
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    } else if (currentSort === 'hottest') {
        filtered.sort((a, b) => (b.hot || 0) - (a.hot || 0));
    } else if (currentSort === 'random') {
        filtered.sort(() => Math.random() - 0.5);
    }

    const resultCount = document.getElementById('resultCount');
    if (resultCount) resultCount.textContent = filtered.length;

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="icon">No Data</div>
                <p>No memes found</p>
                <p>Try another category or search term.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(meme => {
        const optimizedUrl = typeof getOptimizedUrl === 'function' ? getOptimizedUrl(meme.url) : meme.url;
        const fullUrl = meme.url;
        const safeTitle = typeof escapeHtml === 'function' ? escapeHtml(meme.title || 'Untitled') : (meme.title || 'Untitled');
        const isSelected = bulkSelectedIds.has(meme.id);
        const fallbackAttr = encodeFallbackUrls(meme.fallbackUrls || []);
        const checkboxHtml = bulkModeOpen ? `
            <label class="bulk-checkbox" onclick="event.stopPropagation()">
                <input type="checkbox" ${isSelected ? 'checked' : ''}
                    onchange="toggleBulkSelection(${meme.id}, this.checked)"
                    onclick="event.stopPropagation()">
            </label>
        ` : '';

        return `
        <div class="meme-card ${bulkModeOpen ? 'bulk-mode' : ''} ${isSelected ? 'bulk-selected' : ''}" data-id="${meme.id}">
            ${checkboxHtml}
            <img data-src="${optimizedUrl}" data-full="${fullUrl}" data-fallbacks="${fallbackAttr}" alt="${safeTitle}" class="meme-image ${meme.isGif ? 'gif-image' : ''} lazy" loading="lazy"
                onerror="handleImageLoadError(this)"
                onclick="handleMemeClick(event, this.dataset.full || this.currentSrc, ${meme.id})"
                onload="this.classList.add('loaded')">
            <div class="meme-info">
                <div class="meme-title">${safeTitle}</div>
                ${typeof renderMemeTags === 'function' ? renderMemeTags(meme) : ''}
                <div class="meme-meta">
                    <span>${meme.date || ''}</span>
                    ${(meme.hot || 0) >= 80 ? '<span style="color:#FF6B6B;font-weight:800;">Hot</span>' : ''}
                </div>
                <div class="meme-actions">
                    <div class="meme-type ${meme.isGif ? 'gif' : 'static'}">
                        ${meme.isGif ? 'GIF' : 'IMG'}
                    </div>
                    <button class="download-btn" onclick="event.stopPropagation(); downloadMeme('${meme.id}')" title="Download">
                        Download
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join('');

    document.querySelectorAll('.meme-image.lazy').forEach(img => {
        if (window.observeImage) window.observeImage(img);
    });

    if (bulkModeOpen && typeof updateBulkSelectAllState === 'function') {
        updateBulkSelectAllState();
    }
}

async function downloadMeme(id) {
    const meme = memesData.find(m => m.id == id);
    if (!meme) return;

    try {
        if (typeof showToast === 'function') showToast('Downloading...');
        const { response } = await fetchWithFallback(getMemeAssetUrls(meme));
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const extension = meme.isGif ? 'gif' : 'jpg';
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${meme.title || 'phoebe'}.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
        if (typeof showToast === 'function') showToast('Download complete');
    } catch (error) {
        console.error('Download failed:', error);
        const link = document.createElement('a');
        link.href = getMemeAssetUrls(meme)[0] || meme.url;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

async function downloadBulkZip() {
    if (bulkSelectedIds.size === 0) {
        if (typeof showToast === 'function') showToast('Please select at least one item');
        return;
    }
    if (typeof JSZip === 'undefined') {
        if (typeof showToast === 'function') showToast('Zip component is still loading');
        return;
    }

    const selectedMemes = memesData.filter(m => bulkSelectedIds.has(m.id));
    if (typeof showToast === 'function') showToast(`Preparing ${selectedMemes.length} files...`);

    const zip = new JSZip();
    const usedNames = new Set();
    let successCount = 0;
    let failCount = 0;

    const fetchPromises = selectedMemes.map(async (meme) => {
        try {
            const { response } = await fetchWithFallback(getMemeAssetUrls(meme));
            const blob = await response.blob();

            let baseName = typeof sanitizeFileName === 'function' ? sanitizeFileName(meme.title || 'phoebe') : (meme.title || 'phoebe');
            const ext = typeof getExtensionFromUrl === 'function' ? getExtensionFromUrl(meme.url, meme.isGif) : (meme.isGif ? 'gif' : 'jpg');
            let fileName = `${baseName}.${ext}`;
            if (usedNames.has(fileName)) {
                fileName = `${baseName}_${meme.id}.${ext}`;
            }
            if (usedNames.has(fileName)) {
                fileName = `${baseName}_${meme.id}_${Date.now()}.${ext}`;
            }
            usedNames.add(fileName);
            zip.file(fileName, blob);
            successCount++;
        } catch (error) {
            console.error('Zip fetch failed:', meme.id, meme.title, error);
            failCount++;
        }
    });

    await Promise.all(fetchPromises);

    if (successCount === 0) {
        if (typeof showToast === 'function') showToast('Zip build failed, please try again');
        return;
    }

    try {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = zipUrl;
        link.download = `PhoebeHub_${selectedMemes.length}_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);

        if (typeof showToast === 'function') {
            let message = `Packed ${successCount} files`;
            if (failCount > 0) message += `, ${failCount} failed`;
            showToast(message);
        }
    } catch (error) {
        console.error('Zip generation failed:', error);
        if (typeof showToast === 'function') showToast('Zip generation failed');
    }
}
