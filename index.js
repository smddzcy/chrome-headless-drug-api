require('dotenv').config()

const puppeteer = require('puppeteer')
const cheerio = require('cheerio')
const express = require('express')
const fs = require('fs');
const _ = require('lodash');
const request = require('request');
const vision = require('@google-cloud/vision').v1p3beta1;

const app = express()
const gcvImageAnnotator = new vision.ImageAnnotatorClient();

let imageCache = {}
let drugDetailCache = {}

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
  console.log('health check');
  res.send('pong');
})

const getDrugDetails = async (page, name) => {
  const nameLowerCase = name.toLowerCase()
  if (drugDetailCache[nameLowerCase]) return drugDetailCache[nameLowerCase];
  await page.goto(`https://www.goodrx.com/${nameLowerCase}/what-is`)
  const state = await page.evaluate(() => __state__);
  const choices = (state.reduxAsyncConnect.drugPageData.drugConcepts.choices || []).map(c => _.omit(c, ['id', 'image', 'label_type' ]));
  return choices;
}

const getDrugStores = async ({name, form = '', dosage = '', quantity = '', brand = '', zip}, res) => {
  const page = await getBrowserPage()

  try {
    await page.goto(`https://www.goodrx.com/${name}?form=${form || ''}&dosage=${dosage || ''}&quantity=${quantity || ''}&label_override=${brand || ''}`)

    if (zip) {
      await page.goto(`https://www.goodrx.com/change-location?location=${zip}`)
      await page.goto(`https://www.goodrx.com/${name}?form=${form || ''}&dosage=${dosage || ''}&quantity=${quantity || ''}&label_override=${brand || ''}`)
    }

    const state = await page.evaluate(() => __state__);
    const stores = state.reduxAsyncConnect.drugPageData.prices.results;

    res.json({
      stores,
    })
  } catch (e) {
    console.error(e);
    res.json({
      error: { ...e }
    })
  } finally {
    page.close()
  }
}

app.get('/defaultStores', async (req, res) => {
  const { name, zip } = req.query
  console.log('in default stores');
  getDrugStores({ name, zip }, res);
})

app.get('/drugDetails', async (req, res) => {
  const page = await getBrowserPage()

  if (req.query.name) {
    try {
      const drugs = await getDrugDetails(page, req.query.name)
      res.json({ drugs })
    } catch (e) {
      console.error(e);
      res.json({ error: e })
    } finally {
      page.close()
    }
  } else if (req.query.image) {
    const imageLowerCase = req.query.image.toLowerCase()
    if (imageCache[imageLowerCase]) {
      try {
        const drugs = await getDrugDetails(page, imageCache[imageLowerCase]);
        return res.json({ drugs })
      } catch (e) {
        console.error(e)
        return res.json({ error: 'Prescription read unsuccessfully' });
      }
    }
    const tempFilename = `img-temp-${Date.now()}`;
    request(req.query.image).pipe(fs.createWriteStream(tempFilename)).on('close', () => {
      // image downloaded
      const request = {
        image: { content: fs.readFileSync(tempFilename) },
        feature: { languageHints: ['en-t-i0-handwrit'] },
      };
      fs.unlink(tempFilename);
      gcvImageAnnotator
        .documentTextDetection(request)
        .then(async (results) => {
          const text = results[0].fullTextAnnotation.text.replace(/[^\w\d\s]/g, '');
          
          let regex = /(\w+)\s?\d+\s?mg/g, match;
          while (match = regex.exec(text)) {
            let name = match[1].trim()
            console.log(`trying ${name}`);
            
            try {
              const drugs = await getDrugDetails(page, name)
              imageCache[imageLowerCase] = name.toLowerCase()
              return res.json({
                drugs
              })
            } catch (ignored) {}
          }

          regex = /(\w+)?\s?(\w+)?\s?(\w+)\s?\d+\s?mg/g
          while (match = regex.exec(text)) {
            match = match.filter(r => !!r)
            let name = ''
            for (let index = match.length - 1; index > 0; index--) {
              name = `${match[index].trim()} ${name}`.trim()
              // console.log(`name: ${name}`);
              console.log(`trying ${name}`);
              try {
                const drugs = await getDrugDetails(page, name)
                imageCache[imageLowerCase] = name.toLowerCase()
                return res.json({ drugs })
              } catch (ignored) {}
  
              try {
                const idvName = match[index].trim()
                console.log(`trying ${idvName}`);
                // console.log(`idvName: ${idvName}`);
                const drugs = await getDrugDetails(page, idvName)
                imageCache[req.query.image] = idvName
                return res.json({ drugs })
              } catch (ignored) {}
            }
          }

          regex = /(\w+)\s?(\d+)/g, match;
          while (match = regex.exec(text)) {
            if (match[2] < 50) continue;
            let name = match[1].trim()
            console.log(`trying ${name}`);
            
            try {
              const drugs = await getDrugDetails(page, name)
              imageCache[imageLowerCase] = name.toLowerCase()
              return res.json({ drugs })
            } catch (ignored) {}
          }
          res.json({ error: 'Prescription read unsuccessfully' });
        })
        .catch(e => {
          console.error(e);
          res.json({ error: e.error });
        })
    });
  }
})

app.get('/drugStores', async (req, res) => {
  const { name, brand, form, dosage, zip, quantity } = req.query
  getDrugStores({ name, brand, form, dosage, zip, quantity }, res);
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
    console.error(e);
    res.json({
      error: e
    })
  } finally {
    page.close()
  }
})

app.listen(3000, () => console.log('listening on port: 3000'))