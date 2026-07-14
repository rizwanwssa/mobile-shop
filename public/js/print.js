'use strict';
/* Print helpers — wired into the sales page.
 * These open a NEW window/tab for the receipt/PDF. Because the backend
 * requires the Authorization header (window.open() sends none), we FETCH the
 * resource with the token and hand it to the browser as a Blob URL. This keeps
 * auth intact and avoids the 401 that a bare window.open('/api/...') would get.
 */
window.printBill = async function (saleId) {
  try {
    const res = await fetch('/api/sales/' + saleId + '/receipt-html', {
      headers: { 'Authorization': 'Bearer ' + (window.api && window.api.token || '') }
    });
    if (!res.ok) { ui.toast('Could not open receipt (auth)', 'error'); return; }
    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } catch (e) { ui.toast('Could not open receipt', 'error'); }
};

window.downloadInvoicePDF = async function (saleId) {
  try {
    const res = await fetch('/api/invoices/' + saleId + '/pdf', {
      headers: { 'Authorization': 'Bearer ' + (window.api && window.api.token || '') }
    });
    if (!res.ok) { ui.toast('Could not open PDF (auth)', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'INV-' + saleId + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } catch (e) { ui.toast('Could not open PDF', 'error'); }
};
