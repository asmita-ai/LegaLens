const { chromium } = require('playwright');
const path = require('path');

async function testDocument(page, pdfName, customQuestion) {
  console.log(`\n=================================`);
  console.log(`Testing Document: ${pdfName}`);
  console.log(`=================================`);
  
  await page.goto('http://localhost:8002/index.html');
  
  const fileInput = await page.$('#fileInput');
  await fileInput.setInputFiles(path.resolve(pdfName));
  
  // Wait for intake screen
  console.log("Waiting for document type detection...");
  await page.waitForSelector('#intakeScreen.active', { timeout: 30000 });
  
  const docType = await page.textContent('#detectedType');
  console.log(`Detected Type: ${docType}`);
  
  // Select all chips for testing
  const chips = await page.$$('.chip');
  for (const chip of chips) {
    await chip.click();
  }
  
  // Enter a custom question
  if (customQuestion) {
    console.log(`Adding custom question: "${customQuestion}"`);
    await page.fill('#extraConcern', customQuestion);
  }
  
  // Click analyze
  console.log("Running analysis...");
  await page.click('#toIntakeAnalyze');
  
  // Wait for analysis to finish (the status text becomes empty on success)
  await page.waitForSelector('#analysisScreen.active', { timeout: 10000 });
  
  await page.waitForFunction(() => {
    const el = document.getElementById('analysisStatus');
    // If it has text, it's either loading or failed. If it fails, it says "Analysis failed:"
    // It's empty when successfully finished.
    return el && (el.textContent === '' || el.textContent.includes('failed'));
  }, { timeout: 60000 });
  
  const statusText = await page.textContent('#analysisStatus');
  if (statusText.includes('failed')) {
    console.log(`ANALYSIS FAILED: ${statusText}`);
    return;
  }
  
  console.log("\n--- FINDINGS ---");
  const findings = await page.$$('.finding-card');
  for (const f of findings) {
    // Some findings don't have quote (e.g. not found)
    const topicEl = await f.$('.finding-topic');
    const topic = topicEl ? await topicEl.textContent() : '';
    
    const expEl = await f.$('.finding-explanation');
    const exp = expEl ? await expEl.textContent() : '';
    
    const quoteEl = await f.$('.finding-quote');
    const quote = quoteEl ? await quoteEl.textContent() : null;
    
    const unverifiedEl = await f.$('.unverified-note');
    const isUnverified = !!unverifiedEl;
    
    const refBtn = await f.$('.finding-ref[data-clause]');
    const clauseInfo = refBtn ? await refBtn.textContent() : null; // e.g., View Clause · Page X
    
    // Check if it's the pending ask box output which is just checking document
    if (exp.includes('Checking the document')) continue;
    
    console.log(`Topic: ${topic.trim().replace(/\n/g, '').replace(/\\s+/g, ' ')}`);
    console.log(`Explanation: ${exp.trim()}`);
    if (quote) {
      console.log(`Quote: ${quote.trim()}`);
      console.log(`Verified: ${!isUnverified}`);
      console.log(`Reference: ${clauseInfo}`);
    } else {
      console.log(`Found: false (Not in document)`);
    }
    console.log("----------------------");
  }

  // Ask question
  if (customQuestion) {
    console.log(`\n--- ASKING IN CHAT BOX ---`);
    console.log(`Question: ${customQuestion}`);
    
    // Clear custom question box if any? Actually, the question is typed into the ask box in the analysis screen
    await page.fill('#askInput', customQuestion);
    await page.click('#askBtn');
    
    // Wait for the new answer
    await page.waitForFunction(() => {
      const answers = document.querySelectorAll('#askAnswers .finding-card');
      if (answers.length === 0) return false;
      const exp = answers[0].querySelector('.finding-explanation');
      return exp && !exp.textContent.includes('Checking the document');
    }, { timeout: 60000 });
    
    const firstAnswer = (await page.$$('#askAnswers .finding-card'))[0];
    const aTopic = await (await firstAnswer.$('.finding-topic')).textContent();
    const aExp = await (await firstAnswer.$('.finding-explanation')).textContent();
    const aQuoteEl = await firstAnswer.$('.finding-quote');
    const aQuote = aQuoteEl ? await aQuoteEl.textContent() : null;
    
    console.log(`Q Topic: ${aTopic.trim()}`);
    console.log(`Answer: ${aExp.trim()}`);
    if (aQuote) {
      console.log(`Quote: ${aQuote.trim()}`);
    } else {
      console.log(`Found: false`);
    }
    console.log("----------------------");
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('Browser log:', msg.text()));
  page.on('pageerror', err => console.log('Browser error:', err.message));
  page.on('response', response => {
    if (response.status() === 404) console.log('404:', response.url());
  });
  
  // Employment Offer
  await testDocument(
    page, 
    'employment_offer.pdf', 
    'What happens to my stock options if I resign?'
  );
  
  console.log('Waiting 20s to avoid rate limits...');
  await page.waitForTimeout(20000);
  
  // Rental Agreement
  await testDocument(
    page, 
    'rental_agreement.pdf', 
    'Can I sublet the apartment?'
  );

  await browser.close();
})();
