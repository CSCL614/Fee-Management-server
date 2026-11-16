const JSZip = require('jszip');
const XLSX = require('xlsx');

async function testCommentExtractor() {
  const zip = new JSZip();
  zip.file('xl/threadedComments/threadedComment1.xml', 
    `<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">
      <threadedComment ref="W5" dT="2026-06-10T10:00:00.000Z" personId="{P1}">
        <text>Receipt No: REC001, Amount: 5000</text>
      </threadedComment>
      <threadedComment ref="W5" dT="2026-06-11T12:00:00.000Z" personId="{P2}" parentId="{TC1}">
        <text>Verified with bank statement</text>
      </threadedComment>
    </ThreadedComments>`
  );
  zip.file('xl/persons/person.xml', 
    `<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">
      <person id="{P1}" displayName="Finance Cashier" />
      <person id="{P2}" displayName="Chief Accountant" />
    </personList>`
  );

  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const loaded = await JSZip.loadAsync(buf);

  // Parse persons
  const personsMap = {};
  const personFile = loaded.file('xl/persons/person.xml');
  if (personFile) {
    const pXml = await personFile.async('text');
    const pMatches = pXml.matchAll(/<person[^>]*id="([^"]+)"[^>]*displayName="([^"]+)"/g);
    for (const m of pMatches) {
      personsMap[m[1]] = m[2];
    }
  }

  // Parse threaded comments
  const tcFile = loaded.file('xl/threadedComments/threadedComment1.xml');
  if (tcFile) {
    const tcXml = await tcFile.async('text');
    const commentRegex = /<threadedComment\b([^>]*)>([\s\S]*?)<\/threadedComment>/g;
    let match;
    while ((match = commentRegex.exec(tcXml)) !== null) {
      const attrs = match[1];
      const body = match[2];
      const refMatch = attrs.match(/\bref="([^"]+)"/);
      const dtMatch = attrs.match(/\bdT="([^"]+)"/);
      const personMatch = attrs.match(/\bpersonId="([^"]+)"/);
      const parentMatch = attrs.match(/\bparentId="([^"]+)"/);
      const textMatch = body.match(/<text>([\s\S]*?)<\/text>/);

      const ref = refMatch ? refMatch[1] : '';
      const dt = dtMatch ? dtMatch[1] : null;
      const personId = personMatch ? personMatch[1] : null;
      const author = (personId && personsMap[personId]) ? personsMap[personId] : (personId || 'Unknown Author');
      const text = textMatch ? textMatch[1] : '';
      const isReply = Boolean(parentMatch);

      console.log('Extracted Comment:', {
        cellAddress: ref,
        text,
        author,
        timestamp: dt,
        isReply
      });
    }
  }
}

testCommentExtractor();

