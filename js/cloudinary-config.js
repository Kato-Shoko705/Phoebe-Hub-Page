// Cloudinary 配置 - 用户需要替换为自己的配置
const cloudinaryConfig = {
    cloudName: "db4oqv3gv",           // 你的 Cloud name
    uploadPreset: "phoebe_hub_unsigned" // 你的 Upload preset
};

// 导出配置
if (typeof module !== 'undefined' && module.exports) {
    module.exports = cloudinaryConfig;
}
