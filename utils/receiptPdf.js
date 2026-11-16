const PDFDocument = require('pdfkit');

/**
 * Generate a PDF receipt for a payment record
 * @param {Object} payment Payment document
 * @param {Object} student Student document
 * @param {Object} collegeSettings Settings (collegeName, collegeAddress)
 * @returns {Buffer} PDF buffer
 */
function generateReceiptPdf(payment, student, collegeSettings = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A5',
        layout: 'portrait',
        margin: 30
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      const collegeName = collegeSettings.collegeName || 'SRI SAI DEGREE & PG COLLEGE';
      const collegeAddress = collegeSettings.collegeAddress || 'Vizianagaram, Andhra Pradesh';

      // Outer border box
      doc.rect(15, 15, doc.page.width - 30, doc.page.height - 30).strokeColor('#1E3A8A').lineWidth(1.5).stroke();
      doc.rect(18, 18, doc.page.width - 36, doc.page.height - 36).strokeColor('#94A3B8').lineWidth(0.5).stroke();

      // Header Banner
      doc.fillColor('#1E3A8A').fontSize(14).font('Helvetica-Bold').text(collegeName, { align: 'center' });
      doc.moveDown(0.2);
      doc.fillColor('#64748B').fontSize(8).font('Helvetica').text(collegeAddress, { align: 'center' });
      doc.moveDown(0.2);
      doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold').text('OFFICIAL FEE PAYMENT RECEIPT', { align: 'center' });
      doc.moveDown(0.4);

      // Horizontal separator line
      const lineY = doc.y;
      doc.strokeColor('#CBD5E1').lineWidth(0.8).moveTo(25, lineY).lineTo(doc.page.width - 25, lineY).stroke();
      doc.moveDown(0.5);

      // Top Info Grid (Receipt No & Date)
      const isCancelled = payment.status === 'cancelled' || payment.status === 'Cancelled';
      const startInfoY = doc.y;

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155');
      doc.text(`Receipt No: `, 25, startInfoY, { continued: true });
      doc.font('Helvetica-Bold').fillColor(isCancelled ? '#DC2626' : '#1D4ED8').text(`${payment.receiptNo} ${isCancelled ? '[CANCELLED]' : ''}`);

      doc.font('Helvetica').fontSize(8).fillColor('#64748B');
      doc.text(`Transaction Ref: ${payment.transactionId || payment.receiptNo}`, 25, startInfoY + 12);
      doc.text(`Payment Mode: ${payment.paymentMode || 'Cash'}`, 25, startInfoY + 24);

      const rightX = doc.page.width - 170;
      const formattedDate = payment.paymentDate ? new Date(payment.paymentDate).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
      doc.font('Helvetica').fontSize(8).fillColor('#64748B');
      doc.text(`Date: ${formattedDate}`, rightX, startInfoY);
      doc.text(`Academic Session: ${payment.academicYear || student?.currentAcademicYear || '—'}`, rightX, startInfoY + 12);
      doc.text(`Cashier: ${payment.enteredByName || 'Accounts Desk'}`, rightX, startInfoY + 24);

      doc.y = startInfoY + 40;
      doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(25, doc.y).lineTo(doc.page.width - 25, doc.y).stroke();
      doc.moveDown(0.5);

      // Student Particulars Box
      const studentBoxY = doc.y;
      doc.rect(25, studentBoxY, doc.page.width - 50, 48).fillColor('#F8FAFC').fill().strokeColor('#E2E8F0').lineWidth(0.5).stroke();

      const stuName = student?.name || payment.studentName || 'Student';
      const admNo = student?.admissionNo || payment.admissionNo || '—';
      const stuId = student?.studentId || payment.studentId || '—';
      const course = student?.course || payment.course || 'Degree Program';
      const year = payment.year || student?.currentYear || '1st Year';

      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9);
      doc.text(`Student Name: ${stuName}`, 32, studentBoxY + 8);
      doc.font('Helvetica').fontSize(8).fillColor('#475569');
      doc.text(`Admission No: ${admNo}   |   Student ID: ${stuId}`, 32, studentBoxY + 22);
      doc.text(`Course: ${course}   |   Study Year: ${year}`, 32, studentBoxY + 34);

      doc.y = studentBoxY + 56;

      // Category Allocation Table Header
      const tableY = doc.y;
      doc.rect(25, tableY, doc.page.width - 50, 18).fillColor('#1E3A8A').fill();
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      doc.text('#', 30, tableY + 5);
      doc.text('Fee Category / Description', 50, tableY + 5);
      doc.text('Academic Year', 240, tableY + 5);
      doc.text('Amount (INR)', doc.page.width - 95, tableY + 5, { align: 'right', width: 65 });

      let currentY = tableY + 18;
      const allocations = (Array.isArray(payment.allocations) && payment.allocations.length > 0)
        ? payment.allocations
        : [{
            category: payment.feeCategory || 'Tuition Fee Assessment',
            academicYear: payment.academicYear || student?.currentAcademicYear || '—',
            amount: payment.amountPaid
          }];

      allocations.forEach((alloc, idx) => {
        const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        doc.rect(25, currentY, doc.page.width - 50, 16).fillColor(rowBg).fill().strokeColor('#F1F5F9').lineWidth(0.5).stroke();

        doc.fillColor('#334155').font('Helvetica').fontSize(8);
        doc.text(`${idx + 1}`, 30, currentY + 4);
        doc.text(`${alloc.category || 'Tuition Fee'}${alloc.semester ? ` (${alloc.semester})` : ''}`, 50, currentY + 4);
        doc.text(`${alloc.academicYear || payment.academicYear || '—'}`, 240, currentY + 4);
        doc.font('Helvetica-Bold').fillColor('#0F172A').text(
          `INR ${(alloc.amount || 0).toLocaleString('en-IN')}`,
          doc.page.width - 95,
          currentY + 4,
          { align: 'right', width: 65 }
        );
        currentY += 16;
      });

      // Total Paid Row
      doc.rect(25, currentY, doc.page.width - 50, 20).fillColor('#F1F5F9').fill().strokeColor('#CBD5E1').lineWidth(0.8).stroke();
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5);
      doc.text('TOTAL AMOUNT PAID:', 50, currentY + 5);
      doc.fillColor(isCancelled ? '#DC2626' : '#15803D').fontSize(9).text(
        `INR ${(payment.amountPaid || 0).toLocaleString('en-IN')}`,
        doc.page.width - 110,
        currentY + 5,
        { align: 'right', width: 80 }
      );

      currentY += 28;

      // Remarks / Cancellation Alert
      if (isCancelled) {
        doc.rect(25, currentY, doc.page.width - 50, 24).fillColor('#FEF2F2').fill().strokeColor('#FCA5A5').lineWidth(0.5).stroke();
        doc.fillColor('#991B1B').font('Helvetica-Bold').fontSize(8).text(
          `TRANSACTION CANCELLED / REVERSED: ${payment.cancelReason || 'Administrative cancellation'}`,
          30,
          currentY + 7
        );
        currentY += 30;
      } else if (payment.remarks) {
        doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(7.5).text(
          `Remarks: ${payment.remarks}`,
          25,
          currentY
        );
        currentY += 14;
      }

      // Footer: Signature and Notice
      const footerY = doc.page.height - 75;
      doc.strokeColor('#CBD5E1').lineWidth(0.5).moveTo(25, footerY).lineTo(doc.page.width - 25, footerY).stroke();

      doc.fillColor('#64748B').font('Helvetica').fontSize(7);
      doc.text('1. This is a computer-generated official receipt voucher.', 25, footerY + 8);
      doc.text('2. Payments credited to student account in compliance with college ERP ledger rules.', 25, footerY + 18);
      doc.text('3. Retain this voucher for examination hall ticket & TC clearance.', 25, footerY + 28);

      doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8);
      doc.text('Authorized Signatory / Cashier', doc.page.width - 150, footerY + 28, { align: 'right' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReceiptPdf };

