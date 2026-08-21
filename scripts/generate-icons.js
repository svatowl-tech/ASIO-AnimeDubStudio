const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🎨 DubStudio Pro: Запуск генерации иконок для всех платформ...');

// 1. Определение векторного дизайна иконки (размер 512x512)
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <!-- Градиент фона (глубокий темный космический) -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>
    <!-- Градиент центральной кнопки записи (теплый янтарно-оранжевый) -->
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  
  <!-- Скругленная подложка иконки -->
  <rect width="512" height="512" rx="128" fill="url(#bgGrad)"/>
  <!-- Тонкая стильная рамка по краям -->
  <rect x="8" y="8" width="496" height="496" rx="120" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="4"/>
  
  <!-- Эффект свечения за кнопкой записи -->
  <circle cx="256" cy="256" r="180" fill="#f59e0b" opacity="0.12"/>
  <circle cx="256" cy="256" r="130" fill="#f59e0b" opacity="0.25"/>
  <circle cx="256" cy="256" r="80" fill="url(#accentGrad)"/>
  
  <!-- Стилизованная звуковая волна (микрофонная решетка) -->
  <path d="M256 160 v192 M200 200 v112 M140 230 v52 M312 200 v112 M372 230 v52" 
        stroke="#ffffff" 
        stroke-width="24" 
        stroke-linecap="round"/>
</svg>`;

const tempSvgPath = path.join(__dirname, '..', 'app-icon-temp.svg');

try {
  // Запись временного SVG-файла
  fs.writeFileSync(tempSvgPath, svgContent, 'utf8');
  console.log(`[1/3] Временный векторный файл SVG успешно сохранен: ${tempSvgPath}`);

  // Проверка существования каталога иконок
  const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
    console.log(`Создана папка для иконок: ${iconsDir}`);
  }

  // Запуск Tauri Icon Generator
  console.log('[2/3] Запуск генератора Tauri Icon Generator (может занять несколько секунд)...');
  execSync(`npx tauri icon "${tempSvgPath}"`, { stdio: 'inherit' });

  console.log('✅ [3/3] Все виды иконок успешно сгенерированы в папке src-tauri/icons/:');
  console.log('  - icon.ico (для Windows)');
  console.log('  - icon.icns (для macOS)');
  console.log('  - *.png (различные размеры для Linux, iOS, Android)');
} catch (error) {
  console.error('❌ Ошибка во время генерации иконок:', error.message);
  process.exit(1);
} finally {
  // Безопасное удаление временного файла
  if (fs.existsSync(tempSvgPath)) {
    fs.unlinkSync(tempSvgPath);
    console.log('🧹 Временный SVG-файл успешно удален.');
  }
}
