
const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeWebsite(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const title = $('title').text();
        console.log("Page Title:", title);
    } catch (error) {
        console.error("Error fetching site:", error.message);
    }
}

const url = process.argv[2] || 'https://example.com';
scrapeWebsite(url);
