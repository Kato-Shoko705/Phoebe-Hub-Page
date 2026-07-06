/**
 * 图片去重模块 — 基于感知哈希 (Difference Hash / dHash)
 *
 * 原 image_dedup 使用 OpenCV ORB，适合服务端 Python。
 * 本站为静态 GitHub Pages，因此改用纯前端的 dHash：
 *   - 把图片缩放到 (size+1) × size
 * - 转灰度后比较相邻像素，生成 64bit / 256bit 哈希
 * - 用汉明距离衡量差异
 *
 * 适用场景：检测完全重复、轻微压缩、少量裁切的图片。
 * 对于同人物不同姿势的表情包，dHash 差异通常较大，误杀率低。
 */

const DedupConfig = {
    // dHash 尺寸：8x8 相邻比较 => 64bit 哈希。
    // 这个尺寸对表情包足够敏感：同人物不同表情/姿势差异通常 >10，
    // 而完全重复、轻微压缩、少量裁切的图片差异通常 ≤5。
    hashSize: 8,

    // 拦截/强提示阈值：≤5 认为极可能是重复图，展示图片名让用户搜索确认。
    // 5/64 ≈ 92% 相似度，对表情包场景既不会漏掉重复，也不会把"同人物不同表情"误报。
    blockThreshold: 5,

    // 弱提示阈值：≤12 认为较相似，仅做温和提醒。
    // 12/64 ≈ 81% 相似度，对应同系列、构图相近的表情包。
    warnThreshold: 12,

    crossOrigin: 'anonymous'
};

/**
 * 从 File/Blob/URL 计算图片的 dHash。
 * @param {File|Blob|string} source 图片文件或 URL
 * @returns {Promise<string|null>} 64bit 二进制字符串，失败返回 null
 */
async function computeImageHash(source) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = typeof source === 'string' ? source : URL.createObjectURL(source);

        img.onload = () => {
            try {
                const size = DedupConfig.hashSize;
                const canvas = document.createElement('canvas');
                canvas.width = size + 1;
                canvas.height = size;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                // 先绘制为灰度（通过饱和度滤镜），再缩放
                ctx.filter = 'grayscale(100%)';
                ctx.drawImage(img, 0, 0, size + 1, size);

                const data = ctx.getImageData(0, 0, size + 1, size).data;
                let hash = '';

                for (let y = 0; y < size; y++) {
                    for (let x = 0; x < size; x++) {
                        const i = (y * (size + 1) + x) * 4;
                        const next = i + 4;
                        // 灰度已在 R 通道（滤镜后 R=G=B）
                        hash += data[i] > data[next] ? '1' : '0';
                    }
                }

                if (typeof source !== 'string') {
                    URL.revokeObjectURL(objectUrl);
                }
                resolve(hash);
            } catch (e) {
                if (typeof source !== 'string') {
                    URL.revokeObjectURL(objectUrl);
                }
                reject(e);
            }
        };

        img.onerror = () => {
            if (typeof source !== 'string') {
                URL.revokeObjectURL(objectUrl);
            }
            reject(new Error('图片加载失败'));
        };

        img.crossOrigin = DedupConfig.crossOrigin;
        img.src = objectUrl;
    });
}

/**
 * 计算两个二进制哈希的汉明距离。
 */
function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) dist++;
    }
    return dist;
}

/**
 * 将新图片的哈希与已有图片列表比对。
 * @param {string} newHash 新图片哈希
 * @param {Array} existingList 已有图片数组，每项需包含 { firebaseId/id, title, hash, url }
 * @returns {Array} 按相似度排序的 [{ meme, distance, similarity }]
 */
function findSimilarImages(newHash, existingList) {
    if (!newHash || !existingList || existingList.length === 0) return [];

    const results = [];
    for (const meme of existingList) {
        if (!meme.hash) continue;
        const distance = hammingDistance(newHash, meme.hash);
        if (distance <= DedupConfig.warnThreshold) {
            results.push({
                meme,
                distance,
                similarity: 1 - distance / newHash.length
            });
        }
    }

    return results.sort((a, b) => a.distance - b.distance);
}

/**
 * 查找高度相似（可能重复）的图片。
 */
function findDuplicateCandidates(newHash, existingList) {
    return findSimilarImages(newHash, existingList)
        .filter(r => r.distance <= DedupConfig.blockThreshold);
}

/**
 * 安全地从 URL 计算哈希（用于批量处理已有图片）。
 */
async function computeImageHashFromUrl(url) {
    try {
        return await computeImageHash(url);
    } catch (e) {
        console.warn('计算哈希失败:', url, e);
        return null;
    }
}

/**
 * 批量计算 meme 列表的哈希。
 * @param {Array} memes 图片列表
 * @param {Function} onProgress (current, total) => void
 * @returns {Promise<Array>} 带 hash 的列表
 */
async function batchComputeHashes(memes, onProgress) {
    const total = memes.length;
    const results = [];

    for (let i = 0; i < total; i++) {
        const meme = memes[i];
        try {
            const hash = await computeImageHashFromUrl(meme.url);
            if (hash) {
                meme.hash = hash;
                results.push({ id: meme.firebaseId || meme.id, hash });
            }
        } catch (e) {
            console.error(`计算指纹失败 [${i + 1}/${total}]:`, meme.title, e);
        }
        if (onProgress) onProgress(i + 1, total);
        // 小延迟避免阻塞主线程
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
    }

    return results;
}
