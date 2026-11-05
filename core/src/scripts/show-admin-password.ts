export {};
/**
 * 管理员初始密码查询命令（仅可查询一次）
 *
 * 用法：在 core 目录执行 `npm run admin:password`
 * 读取 admin-initial-password.json 中的明文初始密码，打印后立即删除该文件。
 * 再次执行会提示已查询过；如需重置，删除 data/admin.json 后重启服务重新生成。
 */
const fs = require('node:fs');
const { getDataFile } = require('../config/runtime-paths');

const INITIAL_PASSWORD_FILE: string = getDataFile('admin-initial-password.json');

try {
    if (!fs.existsSync(INITIAL_PASSWORD_FILE)) {
        console.log('初始密码已查询过（仅可查询一次），或尚未生成。');
        console.log('如需重置：停止服务 → 删除 data/admin.json → 启动服务 → 重新执行本命令。');
        process.exit(0);
    }
    const data = JSON.parse(fs.readFileSync(INITIAL_PASSWORD_FILE, 'utf8'));
    console.log('========================================');
    console.log(`账号: ${data.username || 'admin'}`);
    console.log(`初始密码: ${data.password}`);
    console.log('========================================');
    console.log('提示: 这是唯一一次展示，请立即保存并尽快在网页上修改密码。');
    fs.unlinkSync(INITIAL_PASSWORD_FILE);
} catch (e: any) {
    console.error('查询失败:', e.message);
    process.exit(1);
}
