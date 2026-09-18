const { chromium } = require('playwright');
const path = require('path');

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  let hasErrors = false;
  
  page.on('pageerror', err => { console.log('PageError:', err.message); hasErrors = true; });
  page.on('console', msg => { 
    if (msg.type() === 'error') { console.log('ConsoleError:', msg.text()); hasErrors = true; }
  });

  console.log('Navigating to app...');
  await page.goto('http://localhost:8005/index.html');
  
  console.log('Uploading document...');
  await page.setInputFiles('#fileInput', path.resolve('employment_offer.pdf'));
  
  await page.waitForSelector('#intakeScreen.active', { timeout: 30000 });
  const chips = await page.$$('.chip');
  for (const c of chips) await c.click();
  await page.click('#toIntakeAnalyze');
  
  console.log('Analyzing document...');
  await page.waitForSelector('#analysisScreen.active', { timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('analysisStatus');
    return el && (el.textContent === '' || el.textContent.includes('failed'));
  }, { timeout: 60000 });
  
  const aStatus = await page.textContent('#analysisStatus');
  if (aStatus.includes('failed')) {
    console.log('Analysis Failed:', aStatus);
    await browser.close();
    return;
  }
  
  // Save english explanations
  const firstEnExplanation = await page.textContent('.finding-card .finding-explanation');
  const firstEnQuote = await page.textContent('.finding-card .finding-quote');
  
  console.log('Switching to Hindi...');
  await page.selectOption('#langSelect', 'hi');
  
  await page.waitForFunction(() => {
    const el = document.getElementById('analysisStatus');
    return el && (el.textContent === '' || el.textContent.includes('failed'));
  }, { timeout: 60000 });
  
  const tStatus = await page.textContent('#analysisStatus');
  if (tStatus.includes('failed')) {
    console.log('Translation Failed:', tStatus);
    await browser.close();
    return;
  }
  
  // Get Hindi explanations
  const firstHiExplanation = await page.textContent('.finding-card .finding-explanation');
  const firstHiQuote = await page.textContent('.finding-card .finding-quote');
  
  console.log('\n--- LANGUAGE TOGGLE TEST RESULTS ---');
  console.log('EN Explanation:', firstEnExplanation.trim());
  console.log('HI Explanation:', firstHiExplanation.trim());
  console.log('EN Quote:', firstEnQuote.trim());
  console.log('HI Quote:', firstHiQuote.trim());
  
  console.log('\nQuote unchanged?', firstEnQuote.trim() === firstHiQuote.trim());
  console.log('Explanation translated?', firstEnExplanation.trim() !== firstHiExplanation.trim());
  
  console.log('\nErrors encountered:', hasErrors);
  await browser.close();
}
run();
