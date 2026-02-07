chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('decoder.html')
  });
});

// Создаем пункт контекстного меню при установке расширения
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'decodeImage',
    title: 'Decode steganography',
    contexts: ['image']
  });
});

// Обработчик клика по пункту контекстного меню
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'decodeImage' && info.srcUrl) {
    // Открываем декодер с URL изображения
    chrome.tabs.create({
      url: chrome.runtime.getURL(`decoder.html?imageUrl=${encodeURIComponent(info.srcUrl)}`)
    });
  }
});


