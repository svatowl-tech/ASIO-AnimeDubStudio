#!/bin/bash
# Скрипт для сборки приложения DubStudio Pro под macOS ARM (Apple Silicon M1/M2/M3)
# Этот скрипт самодостаточен: он проверит и установит все необходимые зависимости (Homebrew, Node.js, Rust),
# и запустит сборку приложения.

set -e

echo "============================================================"
echo "Подготовка к сборке DubStudio Pro для macOS ARM (Apple Silicon)"
echo "============================================================"

# Проверка архитектуры
if [[ $(uname -m) != "arm64" ]]; then
  echo "Внимание: Вы запускаете скрипт не на ARM (Apple Silicon) архитектуре."
  echo "Скрипт продолжит работу, но результат может отличаться."
fi

# Установка Command Line Tools (если не установлены)
if ! xcode-select -p &>/dev/null; then
  echo "Установка Xcode Command Line Tools..."
  xcode-select --install
  echo "Пожалуйста, завершите установку в появившемся окне и перезапустите скрипт."
  exit 1
else
  echo "✅ Xcode Command Line Tools установлены."
fi

# Установка Homebrew (если не установлен)
if ! command -v brew &>/dev/null; then
  echo "Установка Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Добавляем brew в PATH для текущей сессии
  eval "$(/opt/homebrew/bin/brew shellenv)"
else
  echo "✅ Homebrew установлен."
fi

# Установка зависимостей через Homebrew (Node.js)
echo "Проверка Node.js..."
if ! command -v node &>/dev/null; then
  echo "Установка Node.js..."
  brew install node
else
  echo "✅ Node.js установлен (версия $(node -v))."
fi

# Установка Rust (если не установлен)
echo "Проверка Rust..."
if ! command -v rustc &>/dev/null; then
  echo "Установка Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "✅ Rust установлен (версия $(rustc --version))."
fi

# Проверка rust-target для aarch64-apple-darwin
rustup target add aarch64-apple-darwin

# Установка зависимостей проекта
echo "============================================================"
echo "Установка npm зависимостей..."
echo "============================================================"
npm install

# Проверка наличия бинарников ffmpeg
echo "============================================================"
echo "Подготовка sidecar-бинарников (FFmpeg/FFprobe)..."
echo "============================================================"
npm run postinstall

# Сборка проекта
echo "============================================================"
echo "Запуск сборки Tauri приложения..."
echo "============================================================"
# Используем npm run tauri build с явным указанием таргета для M1
npm run tauri build -- --target aarch64-apple-darwin

echo "============================================================"
echo "🎉 Сборка успешно завершена!"
echo "Файлы сборки (DMG и .app) находятся в директории src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ или src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"
echo "============================================================"
