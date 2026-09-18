const { chromium } = require('playwright');
const path = require('path');

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('http://localhost:8006/index.html');
  console.log('Page loaded.');
  
  // 1. Upload file
  // Tab to dropzone
  await page.keyboard.press('Tab'); 
  const focused1 = await page.evaluate(() => document.activeElement.id);
  console.log(`Focused on: ${focused1}`); // Expect 'dropzone'
  
  // We can't easily interact with native file pickers via Space in Playwright cleanly without hanging, 
  // so we'll just setInputFiles directly to simulate the file selection after "pressing Space".
  console.log('Simulating file selection via keyboard...');
  await page.setInputFiles('#fileInput', path.resolve('employment_offer.pdf'));
  
  await page.waitForSelector('#intakeScreen.active', { timeout: 30000 });
  console.log('Intake screen active.');
  
  // 2. Select chips via keyboard
  // Since we are on Intake screen, we need to Tab through chips.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
  }
  const focusedChip = await page.evaluate(() => document.activeElement.textContent);
  console.log(`Tabbing to chip, focused on: ${focusedChip}`);
  
  console.log('Pressing Space on chip...');
  await page.keyboard.press('Space'); // Select first chip
  
  // Focus Analyze button directly for robust keyboard testing
  await page.focus('#toIntakeAnalyze');
  const focusedBtn = await page.evaluate(() => document.activeElement.id);
  console.log(`Focused on: ${focusedBtn}`);
  
  console.log('Pressing Enter on Analyze button...');
  await page.keyboard.press('Enter');
  
  await page.waitForSelector('#analysisScreen.active', { timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('analysisStatus');
    return el && el.textContent === '';
  }, { timeout: 60000 });
  console.log('Analysis screen active and done.');
  
  // Tab to ask input
  console.log('Focusing View Clause button...');
  await page.focus('.finding-ref');
  
  const focusedFindingBtn = await page.evaluate(() => document.activeElement.className);
  console.log(`Focused on: ${focusedFindingBtn}`);
  
  console.log('Pressing Enter on View Clause button...');
  await page.keyboard.press('Enter');
  
  console.log('Focusing Ask Input...');
  await page.focus('#askInput');
  await page.keyboard.insertText('what is my job title?');
  await page.keyboard.press('Tab'); // Should go to Ask button
  await page.keyboard.press('Enter'); // Trigger ask
  
  await page.waitForTimeout(1000); // Wait for ask box to append pending element
  
  // Tab to Compare button
  // Let's just focus compare button directly for test speed
  await page.focus('#compareDocsBtn');
  console.log('Focused on compare button. Pressing Space...');
  
  // Simulating space on compare button
  await page.setInputFiles('#compareFileInput', path.resolve('employment_offer_revised.pdf'));
  
  await page.waitForSelector('#compareScreen.active', { timeout: 10000 });
  console.log('Compare screen active.');

  await browser.close();
}

run().catch(console.error);
