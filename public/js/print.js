'use strict';
/* Print helpers — wired by the lead agent into the sales page. */
window.printBill = function (saleId) {
  window.open('/api/sales/' + saleId + '/receipt-html', '_blank');
};

window.downloadInvoicePDF = function (saleId) {
  window.open('/api/invoices/' + saleId + '/pdf', '_blank');
};
