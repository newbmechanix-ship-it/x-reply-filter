const DEFAULTS = { enabled: true, showOP: true, mode: 'collapse', hideListAdds: true };

const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('enabled').checked = s.enabled;
  $('showOP').checked = s.showOP;
  $('mode').value = s.mode;
  $('hideListAdds').checked = s.hideListAdds;
});

$('hideListAdds').addEventListener('change', (e) => chrome.storage.sync.set({ hideListAdds: e.target.checked }));

$('enabled').addEventListener('change', (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$('showOP').addEventListener('change', (e) => chrome.storage.sync.set({ showOP: e.target.checked }));
$('mode').addEventListener('change', (e) => chrome.storage.sync.set({ mode: e.target.value }));

$('clear').addEventListener('click', () => {
  chrome.storage.local.set({ mutuals: [] }, () => {
    $('clear').textContent = 'Cleared';
    setTimeout(refreshStats, 300);
  });
});

function refreshStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'xrf-stats' }, (res) => {
      if (chrome.runtime.lastError || !res) return; // not an x.com tab
      $('stats').textContent = res.active
        ? `${res.hidden} repl${res.hidden === 1 ? 'y' : 'ies'} hidden on this page · ${res.known} accounts seen · ${res.mutuals} mutuals cached`
        : `Open a post or Notifications to filter replies · ${res.mutuals} mutuals cached`;
    });
  });
}

refreshStats();
