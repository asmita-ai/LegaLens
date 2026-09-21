const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function run() {
  const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, '..', req.url);
    if (req.url === '/') filePath = path.join(__dirname, '..', 'index.html');
    fs.readFile(filePath, (error, content) => {
      if (error) { res.writeHead(404); res.end(); }
      else { res.writeHead(200); res.end(content, 'utf-8'); }
    });
  });
  
  server.listen(8006);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('http://localhost:8006/index.html');
  
  const results = await page.evaluate(() => {
    let passed = 0;
    let failed = 0;
    const fails = [];

    function assertEq(name, actual, expected) {
      if (actual === expected) { passed++; }
      else { failed++; fails.push(`[${name}] Expected ${expected} but got ${actual}`); }
    }

    // --- TEST splitClauses ---
    const samplePages = [
      { page: 1, text: "INTRODUCTION\nWelcome to the company.\n1. SALARY\nYour salary is $100.\n" },
      { page: 2, text: "2. NOTICE\nNotice is 30 days.\n" }
    ];
    
    const clauses = splitClauses(samplePages);
    
    assertEq('splitClauses counts', clauses.length, 3);
    if (clauses.length === 3) {
      assertEq('clause 1 heading', clauses[0].heading, "Page 1 continued"); // No numbered heading detected
      assertEq('clause 2 heading', clauses[1].heading, "1 SALARY"); // Numbered heading detected
      assertEq('clause 3 page', clauses[2].page, 2);
    }
    
    // --- TEST verifyFinding ---
    const testClauses = [
      { id: 'c1', heading: '1. SALARY', text: 'Your salary is $100.', page: 1 },
      { id: 'c2', heading: '2. NOTICE', text: 'Notice is 30 days. No exceptions.', page: 2 }
    ];
    const fullText = "INTRODUCTION\nYour salary is $100.\n2. NOTICE\nNotice is 30 days. No exceptions.";
    
    state.clauses = testClauses;
    state.fullText = fullText;
    
    // 1. Exact match with correct clauseId
    const v1 = verifyFinding({ found: true, quote: "Your salary is $100.", clauseId: 'c1' });
    assertEq('verify exact', v1.verified, true);
    assertEq('verify exact clauseId', v1.resolvedClause.id, 'c1');
    
    // 2. Partial match (with spaces/formatting differences but correct punctuation)
    const v2 = verifyFinding({ found: true, quote: "notice is 30 days.    no exceptions.", clauseId: 'c2' });
    assertEq('verify partial', v2.verified, true);
    
    // 3. Fabricated quote
    const v3 = verifyFinding({ found: true, quote: "You get 50 days of vacation", clauseId: 'c1' });
    assertEq('verify fabricated', v3.verified, false);
    
    return { passed, failed, fails };
  });

  console.log(`Unit Tests: ${results.passed} passed, ${results.failed} failed`);
  if (results.fails.length > 0) {
    console.log("Failures:");
    results.fails.forEach(f => console.log(f));
  }

  await browser.close();
  server.close();
}

run();
