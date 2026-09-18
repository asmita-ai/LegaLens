const { chromium } = require('playwright');
const path = require('path');

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(200000);
  let hasErrors = false;
  
  page.on('pageerror', err => { console.log('PageError:', err.message); hasErrors = true; });
  page.on('console', msg => { 
    if (msg.type() === 'error') { console.log('ConsoleError:', msg.text()); hasErrors = true; }
    else { console.log('BrowserLog:', msg.text()); }
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:8004/index.html');
  
  // Upload Doc A
  console.log('Uploading Doc A...');
  await page.setInputFiles('#fileInput', path.resolve('employment_offer.pdf'));
  
  // Intake Doc A
  await page.waitForSelector('#intakeScreen.active', { timeout: 30000 });
  const chips = await page.$$('.chip');
  for (const c of chips) await c.click();
  await page.click('#toIntakeAnalyze');
  
  // Wait for Doc A analysis
  console.log('Analyzing Doc A...');
  await page.waitForSelector('#analysisScreen.active', { timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('analysisStatus');
    return el && (el.textContent === '' || el.textContent.includes('failed'));
  }, { timeout: 60000 });
  const aStatus = await page.textContent('#analysisStatus');
  if (aStatus.includes('failed')) {
    console.log('Doc A Analysis Failed:', aStatus);
    await browser.close();
    return;
  }
  
  // Start Compare
  console.log('Uploading Doc B for comparison...');
  await page.setInputFiles('#compareFileInput', path.resolve('employment_offer_revised.pdf'));
  
  // Wait for Compare analysis
  console.log('Running Compare Analysis...');
  await page.waitForSelector('#compareScreen.active', { timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('compareStatus');
    return el && (el.textContent === '' || el.textContent.includes('failed') || el.textContent.includes('No topics'));
  }, { timeout: 60000 });
  
  const cStatus = await page.textContent('#compareStatus');
  if (cStatus.includes('failed') || cStatus.includes('No topics')) {
    console.log('Compare Failed:', cStatus);
    await browser.close();
    return;
  }
  
  // Print results
  console.log('\n--- COMPARE RESULTS ---');
  const cards = await page.$$('#compareResults .finding-card');
  for (const card of cards) {
    const topic = await (await card.$('.finding-topic'))?.textContent() || '';
    const explanation = await (await card.$('.finding-explanation'))?.textContent() || '';
    
    // There are two divs for A and B side-by-side
    // We can extract text simply
    const textContent = await card.textContent();
    console.log(`Topic: ${topic.trim()}`);
    console.log(`Explanation: ${explanation.trim()}`);
    
    // Detailed extraction:
    const quotes = await card.$$('.finding-quote');
    const unverifieds = await card.$$('.unverified-note');
    console.log(`Extracted text:\n${textContent.replace(/\n+/g, ' ').trim()}`);
    console.log('---');
  }

  console.log('Errors encountered:', hasErrors);
  await browser.close();
}
run();
