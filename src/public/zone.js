// Starts a new session in the time zone of the browser, when the creator has not used a zone yet.
for (const select of document.querySelectorAll('select[data-zone=auto]')) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if ([...select.options].some(option => option.value === zone)) select.value = zone;
}
