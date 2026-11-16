const JSZip = require('jszip');
const XLSX = require('xlsx');

/**
 * Intelligent pattern detectors for financial transaction details inside Excel comments
 */
const PATTERNS = {
  receiptNo: /(?:receipt(?:\s*no|\s*#|\s*number)?|rcpt(?:\s*no)?|voucher(?:\s*no)?|vch(?:\s*no)?|bill(?:\s*no)?|rec(?:\s*no)?)\s*[:=\-#]?\s*([a-zA-Z0-9\-_/]+)/i,
  generalReceipt: /\b(REC[0-9]{3,}|RCPT[0-9]{3,}|VCH[0-9]{3,})\b/i,
  txnId: /(?:txn(?:\s*id|\s*ref|\s*no)?|transaction(?:\s*id|\s*ref|\s*reference|\s*no)?|utr(?:\s*no)?|ref(?:\s*no|\s*id)?|reference(?:\s*no|\s*id)?|bank\s*ref|rrn)\s*[:=\-#]?\s*([a-zA-Z0-9\-_/]+)/i,
  generalTxn: /\b(TXN[0-9]{4,}|UTR[0-9]{6,}|UPI[0-9]{6,})\b/i,
  amount: /(?:amount|amt|paid|fee|sum|rs\.?|inr|₹)\s*[:=\-]?\s*(?:rs\.?|inr|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
  paymentMode: /\b(cash|upi|card|credit\s*card|debit\s*card|net\s*banking|bank\s*transfer|neft|rtgs|imps|cheque|check|demand\s*draft|dd|gpay|phonepe|paytm)\b/i,
  date: /\b(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}|\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2})\b/
};

/**
 * Split cell address like 'W5' into col 'W' and row 5
 */
function parseCellAddress(addr) {
  if (!addr) return { col: '', row: 0 };
  const match = String(addr).trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return { col: '', row: 0 };
  return { col: match[1], row: parseInt(match[2], 10) };
}

/**
 * Extract pattern matches from raw comment text
 */
function analyzeCommentText(text) {
  if (!text) return { hasReference: false, suggestedFieldMapping: { field: 'remarks', confidence: 'none' } };

  const cleanText = String(text).trim();

  // Receipt No
  let detectedReceiptNo = null;
  const rMatch = cleanText.match(PATTERNS.receiptNo) || cleanText.match(PATTERNS.generalReceipt);
  if (rMatch) {
    detectedReceiptNo = rMatch[1].trim();
  }

  // Transaction ID
  let detectedTxnId = null;
  const tMatch = cleanText.match(PATTERNS.txnId) || cleanText.match(PATTERNS.generalTxn);
  if (tMatch) {
    detectedTxnId = tMatch[1].trim();
  }

  // Amount
  let detectedAmount = null;
  const aMatch = cleanText.match(PATTERNS.amount);
  if (aMatch) {
    const rawAmt = aMatch[1].replace(/,/g, '');
    const parsed = parseFloat(rawAmt);
    if (!isNaN(parsed) && parsed > 0) {
      detectedAmount = parsed;
    }
  }

  // Payment Mode
  let detectedPaymentMode = null;
  const mMatch = cleanText.match(PATTERNS.paymentMode);
  if (mMatch) {
    const mStr = mMatch[1].toLowerCase();
    if (mStr.includes('upi') || mStr.includes('gpay') || mStr.includes('phonepe') || mStr.includes('paytm')) detectedPaymentMode = 'UPI';
    else if (mStr.includes('card')) detectedPaymentMode = 'Card';
    else if (mStr.includes('transfer') || mStr.includes('bank') || mStr.includes('neft') || mStr.includes('rtgs') || mStr.includes('imps')) detectedPaymentMode = 'Bank Transfer';
    else if (mStr.includes('cheque') || mStr.includes('check') || mStr.includes('dd')) detectedPaymentMode = 'Cheque';
    else if (mStr.includes('cash')) detectedPaymentMode = 'Cash';
  }

  // Date
  let detectedDate = null;
  const dMatch = cleanText.match(PATTERNS.date);
  if (dMatch) {
    const dStr = dMatch[1];
    const parts = dStr.split(/[-/\.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (!isNaN(dt.getTime())) detectedDate = dt;
      } else {
        // DD-MM-YYYY or MM-DD-YYYY
        const p1 = parseInt(parts[0], 10);
        const p2 = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        const dt = new Date(year, p2 - 1, p1);
        if (!isNaN(dt.getTime())) detectedDate = dt;
      }
    }
  }

  const hasReference = Boolean(detectedReceiptNo || detectedTxnId || (detectedAmount && detectedPaymentMode));
  const confidence = (detectedReceiptNo && detectedAmount) ? 'high' : (detectedReceiptNo || detectedTxnId ? 'medium' : (hasReference ? 'low' : 'none'));

  return {
    hasReference,
    suggestedFieldMapping: {
      field: hasReference ? 'payment' : 'remarks',
      detectedReceiptNo,
      detectedTxnId,
      detectedDate,
      detectedAmount,
      detectedPaymentMode,
      confidence
    }
  };
}

/**
 * Extract all cell comments and notes from an Excel file buffer
 * Supports:
 * - Traditional Excel Notes (stored in cell.c)
 * - Modern Threaded Comments and replies (stored in xl/threadedComments/*.xml)
 * - Author mapping from xl/persons/person.xml
 * 
 * @param {Buffer} fileBuffer Uploaded file buffer
 * @param {Object} wb SheetJS workbook instance
 * @param {Array} parsedRows Parsed rows with row mapping
 * @returns {Promise<Object>} { comments: Array, summary: Object }
 */
async function extractAllCommentsFromWorkbook(fileBuffer, wb, parsedRows = []) {
  const extractedList = [];
  const commentKeySet = new Set(); // To prevent duplicates between traditional and threaded

  // Map row index to student data if available
  const rowToStudentMap = new Map();
  if (Array.isArray(parsedRows)) {
    parsedRows.forEach((r, idx) => {
      const excelRow = idx + 2; // header is row 1
      rowToStudentMap.set(excelRow, {
        admissionNo: r.data?.admissionNo || r.admissionNo || '',
        studentName: r.data?.name || r.name || '',
        studentId: r.data?.studentId || r.studentId || null
      });
    });
  }

  // -------------------------------------------------------------
  // STEP 1: Extract Traditional Notes from SheetJS
  // -------------------------------------------------------------
  if (!wb && fileBuffer) {
    try {
      wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, cellComments: true });
    } catch (e) {
      // ignore
    }
  }

  if (wb && wb.SheetNames) {
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;

      // Extract column headers from row 1
      const colHeaders = {};
      Object.keys(sheet).forEach(cellAddr => {
        if (cellAddr.startsWith('!')) return;
        const parsed = parseCellAddress(cellAddr);
        if (parsed.row === 1 && sheet[cellAddr] && sheet[cellAddr].v != null) {
          colHeaders[parsed.col] = String(sheet[cellAddr].v).trim();
        }
      });

      // Iterate through all cells in sheet
      for (const cellAddr of Object.keys(sheet)) {
        if (cellAddr.startsWith('!')) continue;
        const cell = sheet[cellAddr];
        if (!cell || !cell.c) continue;

        const cellParsed = parseCellAddress(cellAddr);
        const cellValue = cell.w || cell.v || '';
        const relatedField = colHeaders[cellParsed.col] || `Column ${cellParsed.col}`;
        const studentMeta = rowToStudentMap.get(cellParsed.row) || {};

        const commentsArray = Array.isArray(cell.c) ? cell.c : [cell.c];
        for (const cItem of commentsArray) {
          const rawText = (cItem.t || cItem.text || cItem.r || '').trim();
          if (!rawText) continue;

          const author = (cItem.a || cItem.author || 'Author').trim();
          const uniqueKey = `${sheetName}::${cellAddr}::${rawText}`;

          if (!commentKeySet.has(uniqueKey)) {
            commentKeySet.add(uniqueKey);
            const analysis = analyzeCommentText(rawText);

            extractedList.push({
              worksheetName: sheetName,
              cellAddress: cellAddr,
              rowNumber: cellParsed.row,
              colLetter: cellParsed.col,
              relatedField,
              originalCellValue: cellValue,
              originalCommentText: rawText,
              commentAuthor: author,
              commentTimestamp: null,
              isThreaded: false,
              isReply: false,
              studentId: studentMeta.studentId || null,
              admissionNo: studentMeta.admissionNo || null,
              studentName: studentMeta.studentName || null,
              hasReference: analysis.hasReference,
              suggestedFieldMapping: analysis.suggestedFieldMapping,
              verificationStatus: 'unverified'
            });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 2: Extract Modern Threaded Comments from ZIP (Office 365)
  // -------------------------------------------------------------
  try {
    const zip = await JSZip.loadAsync(fileBuffer);

    // Parse person list if present
    const personsMap = {};
    const personFile = zip.file('xl/persons/person.xml');
    if (personFile) {
      const pXml = await personFile.async('text');
      const pMatches = pXml.matchAll(/<person\b[^>]*id="([^"]+)"[^>]*displayName="([^"]+)"/g);
      for (const m of pMatches) {
        personsMap[m[1]] = m[2];
      }
    }

    // Worksheet mapping from workbook.xml
    const sheetFileMap = {};
    const wbXmlFile = zip.file('xl/workbook.xml');
    if (wbXmlFile) {
      const wbXml = await wbXmlFile.async('text');
      const sMatches = wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*sheetId="([^"]+)"/g);
      for (const m of sMatches) {
        sheetFileMap[m[2]] = m[1];
      }
    }

    // Scan for all threaded comment files in xl/threadedComments/
    const threadedFiles = Object.keys(zip.files).filter(f => f.startsWith('xl/threadedComments/threadedComment') && f.endsWith('.xml'));

    for (const tcFilePath of threadedFiles) {
      const tcFile = zip.file(tcFilePath);
      if (!tcFile) continue;

      const tcXml = await tcFile.async('text');
      const commentRegex = /<threadedComment\b([^>]*)>([\s\S]*?)<\/threadedComment>/g;
      let match;

      // Extract sheet index from path (e.g. threadedComment1.xml -> sheet 1)
      const numMatch = tcFilePath.match(/threadedComment(\d+)\.xml/);
      const sheetIndex = numMatch ? numMatch[1] : '1';
      const sheetName = sheetFileMap[sheetIndex] || (wb.SheetNames && wb.SheetNames[parseInt(sheetIndex, 10) - 1]) || `Sheet${sheetIndex}`;

      const sheetObj = wb ? wb.Sheets[sheetName] : null;

      // Extract column headers
      const colHeaders = {};
      if (sheetObj) {
        Object.keys(sheetObj).forEach(addr => {
          if (addr.startsWith('!')) return;
          const parsed = parseCellAddress(addr);
          if (parsed.row === 1 && sheetObj[addr] && sheetObj[addr].v != null) {
            colHeaders[parsed.col] = String(sheetObj[addr].v).trim();
          }
        });
      }

      while ((match = commentRegex.exec(tcXml)) !== null) {
        const attrs = match[1];
        const body = match[2];

        const refMatch = attrs.match(/\bref="([^"]+)"/);
        const dtMatch = attrs.match(/\bdT="([^"]+)"/);
        const personMatch = attrs.match(/\bpersonId="([^"]+)"/);
        const parentMatch = attrs.match(/\bparentId="([^"]+)"/);
        const textMatch = body.match(/<text>([\s\S]*?)<\/text>/);

        const cellAddr = refMatch ? refMatch[1].toUpperCase() : '';
        if (!cellAddr) continue;

        const rawText = textMatch ? textMatch[1].trim() : '';
        if (!rawText) continue;

        const cellParsed = parseCellAddress(cellAddr);
        const cellValue = sheetObj && sheetObj[cellAddr] ? (sheetObj[cellAddr].w || sheetObj[cellAddr].v || '') : '';
        const relatedField = colHeaders[cellParsed.col] || `Column ${cellParsed.col}`;
        const studentMeta = rowToStudentMap.get(cellParsed.row) || {};

        const dtStr = dtMatch ? dtMatch[1] : null;
        let commentDate = null;
        if (dtStr) {
          const d = new Date(dtStr);
          if (!isNaN(d.getTime())) commentDate = d;
        }

        const personId = personMatch ? personMatch[1] : null;
        const author = (personId && personsMap[personId]) ? personsMap[personId] : (personId || 'Office 365 User');
        const isReply = Boolean(parentMatch);

        const uniqueKey = `${sheetName}::${cellAddr}::${rawText}`;
        if (!commentKeySet.has(uniqueKey)) {
          commentKeySet.add(uniqueKey);
          const analysis = analyzeCommentText(rawText);

          extractedList.push({
            worksheetName: sheetName,
            cellAddress: cellAddr,
            rowNumber: cellParsed.row,
            colLetter: cellParsed.col,
            relatedField,
            originalCellValue: cellValue,
            originalCommentText: rawText,
            commentAuthor: author,
            commentTimestamp: commentDate,
            isThreaded: true,
            isReply,
            parentCommentId: parentMatch ? parentMatch[1] : null,
            studentId: studentMeta.studentId || null,
            admissionNo: studentMeta.admissionNo || null,
            studentName: studentMeta.studentName || null,
            hasReference: analysis.hasReference,
            suggestedFieldMapping: analysis.suggestedFieldMapping,
            verificationStatus: 'unverified'
          });
        }
      }
    }
  } catch (zipErr) {
    // If ZIP parsing fails (e.g. legacy binary .xls), SheetJS comments from Step 1 are preserved
  }

  // Calculate summary metrics
  const totalComments = extractedList.length;
  const totalReferences = extractedList.filter(c => c.hasReference).length;
  const unverifiedReferences = totalReferences;
  const unmappedComments = totalComments - totalReferences;

  return {
    comments: extractedList,
    summary: {
      totalCommentsExtracted: totalComments,
      totalReferencesIdentified: totalReferences,
      unverifiedReferences,
      unmappedComments
    }
  };
}

module.exports = {
  extractAllCommentsFromWorkbook,
  analyzeCommentText,
  parseCellAddress
};
