#!/bin/bash

# Скрипт для создания zip архива Chrome расширения
# Создаёт архив на уровень выше текущей директории

# Получаем имя текущей директории
CURRENT_DIR=$(basename "$(pwd)")
PARENT_DIR=$(dirname "$(pwd)")

# Имя архива с текущей датой и временем
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_NAME="${CURRENT_DIR}_${TIMESTAMP}.zip"
ARCHIVE_PATH="${PARENT_DIR}/${ARCHIVE_NAME}"

# Переходим в директорию проекта
cd "$(dirname "$0")" || exit 1

echo "Создание архива Chrome расширения..."
echo "Архив будет создан: ${ARCHIVE_PATH}"

# Создаём zip архив, исключая ненужные файлы
zip -r "${ARCHIVE_PATH}" . \
  -x "*.git/*" \
  -x "node_modules/*" \
  -x "*.zip" \
  -x "build.sh" \
  -x "package.json" \
  -x "README.md" \
  -x "TODO" \
  -x "test.html" \
  -x "test.py" \
  -x "*.test.js" \
  -x ".DS_Store" \
  -x "*.log" \
  -x ".vscode/*" \
  -x ".idea/*"

if [ $? -eq 0 ]; then
  echo "✓ Архив успешно создан: ${ARCHIVE_PATH}"
  echo "Размер архива: $(du -h "${ARCHIVE_PATH}" | cut -f1)"
else
  echo "✗ Ошибка при создании архива"
  exit 1
fi

