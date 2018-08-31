const puppeteer = require('puppeteer')
const cheerio = require('cheerio')
const express = require('express')
const app = express()

let browser
puppeteer.launch().then(b => {
  console.log('Browser launched');
  browser = b
})

const getBrowserPage = async () => {
  page = await browser.newPage()
  page.on('console', msg => {
    for (let i = 0; i < msg.args().length; ++i)
      console.log(`Console called with param ${i}: ${msg.args()[i]}`)
  })
  return page
}

app.get('/ping', (req, res) => {
  res.send('pong')
})

app.get('/drugDetails', async (req, res) => {
  const page = await getBrowserPage()
  await page.goto(`https://www.goodrx.com/${req.query.name}/what-is`)

  try {
    const data = await page.$eval('#jsonData #drug', node => JSON.parse(node.innerHTML))

    const drugs = data.equivalent_drugs
    // Remove unnecessary fields
    for (const name in drugs) {
      delete drugs[name].slug
      delete drugs[name].form_sort
      delete drugs[name].default_days_supply

      for (var form in drugs[name].forms) {
        delete drugs[name].forms[form].dosage_sort
      }
    }
    res.json({
      drugs,
    })
  } catch (e) {
    res.json({
      error: e
    })
  } finally {
    page.close()
  }
})

app.get('/drugStores', async (req, res) => {
  const page = await getBrowserPage()
  const {
    name,
    brand,
    form,
    dosage,
    quantity
  } = req.query

  try {
    await page.goto(`https://www.goodrx.com/${name}?form=${form}&dosage=${dosage}&quantity=${quantity}&label_override=${brand}`)

    const stores = await page.$$eval('.price-row', rows => rows.map(row => ({
      name: row.querySelector('.store-name').innerText,
      price: row.querySelector('.drug-price').innerText,
      url: encodeURIComponent(row.querySelector('.pricerow-button button').dataset['href'].slice(1))
    })))

    res.json({
      stores,
    })
  } catch (e) {
    res.json({
      error: e
    })
  } finally {
    page.close()
  }
})

app.get('/couponDetails', async (req, res) => {
  const page = await getBrowserPage()
  const {
    url
  } = req.query

  try {
    await page.goto(`https://www.goodrx.com/${url}`)
    const coupon = await page.evaluate(() => window.couponDrug)
    res.json({
      coupon,
    })
  } catch (e) {
    res.json({
      error: e
    })
  } finally {
    page.close()
  }
})

app.listen(3000, () => console.log('listening on port: 3000'))