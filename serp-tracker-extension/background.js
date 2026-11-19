// Shows your best organic rank on the toolbar icon for the tab you are looking at.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'captured' && sender.tab) {
    const text = msg.myBestOrganic ? String(msg.myBestOrganic) : '';
    chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#1a7f37' });
  }
});
