const fs = require('fs');
const { execSync } = require('child_process');

console.log('1. Собираем Expo...');
execSync('npx expo export -p web', { stdio: 'inherit' });

console.log('2. Готовим структуру папок для Cloudflare...');
fs.rmSync('./deploy', { recursive: true, force: true });
fs.mkdirSync('./deploy/app', { recursive: true });

// Переносим сборку из dist внутрь deploy/app
fs.cpSync('./dist', './deploy/app', { recursive: true });

// ВАЖНО: кладем копию index.html в корень, 
// чтобы Cloudflare мог отдавать его при 404 (для работы роутинга внутри Expo)
fs.copyFileSync('./deploy/app/index.html', './deploy/index.html');

// console.log('3. Отправляем в Cloudflare...');
// execSync('npx wrangler deploy', { stdio: 'inherit' });