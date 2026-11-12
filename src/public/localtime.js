// Shows each stream of the schedule in the time zone of the fan (RDY r-ZN5Y9). Without this script the page shows UTC.
for (const box of document.querySelectorAll('b[data-day]')) {
  const at = new Date(box.dataset.day);
  if (Number.isNaN(at.getTime())) continue;
  box.replaceChildren(at.toLocaleDateString('en-US', {weekday: 'short'}).toUpperCase(), document.createElement('br'), String(at.getDate()));
}
for (const time of document.querySelectorAll('time[data-show]')) {
  const at = new Date(time.dateTime);
  if (Number.isNaN(at.getTime())) continue;
  const clock = at.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  time.textContent = time.dataset.show === 'day'
    ? at.toLocaleDateString('en-US', {weekday: 'short', day: 'numeric', month: 'short'}) + ', ' + clock
    : clock;
}
