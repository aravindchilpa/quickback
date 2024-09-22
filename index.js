const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');
const Groq = require('groq-sdk');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3031;
const cache = new NodeCache({ stdTTL: 43200 }); // Cache time-to-live of 12 hours

app.use(express.static('public'));
app.use(cors());
app.use(bodyParser.json());

const groq = new Groq({ apiKey: process.env.AI });

// Mock function to simulate the rewriteUsingGroq function
const rewriteUsingGroq = async (text, prompt) => {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: `${prompt} "${text}". Provide as detailed a response as possible.`
                }
            ],
            model: "llama-3.1-8b-instant"
        });
        return chatCompletion.choices[0]?.message?.content.trim() || '';
    } catch (error) {
        throw error;
    }
};

app.post('/topnews/url', async (req, res) => {
    const url = req.body.url;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const articleTitle = $('.article-HD').text().trim();
        const articleImage = $('.articleImg img').attr('src');
        const articleBody = $('.ArticleBodyCont p').map((i, el) => $(el).text().trim()).get().join('\n');

        // Rewrite the title and body using the rewriteUsingGroq function
        const rewrittenTitle = await rewriteUsingGroq(articleTitle, "Rewrite the following title with only one option and single title, Don't give multiple titles and without any explanation and as detailed title as possible and only in telugu laungage and rewrite this without changing the actual meaning:");
        const rewrittenBody = await rewriteUsingGroq(articleBody, 'Rewrite the following text and as big response as possible and as detailed text as possible and only in telugu laungage and rewrite in more than 4000 words:');

        res.json({
            title: rewrittenTitle,
            image: articleImage,
            body: rewrittenBody
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to scrape the URL' });
    }
});

// Define your API keys
const apiKeys = {
    telugu: process.env.TELUGU,
    english: process.env.ENGLISH,
    search: process.env.SEARCH,
};
const country = "in";

// Counters for tracking requests
let apiRequestCount = 0;
let originalApiRequestCounts = {
    telugu: 0,
    english: 0,
    search: 0,
};

// Rate limiting configuration
const rateLimitWindow = 15 * 60 * 1000; // 15 minutes in milliseconds
const rateLimit = 30; // 30 requests per 15 minutes
let rateLimitResetTime = Date.now() + rateLimitWindow;
let firstRequestTime = null;

// Function to reset rate limit counters
function resetRateLimit() {
    apiRequestCount = 0;
    originalApiRequestCounts = {
        telugu: 0,
        english: 0,
        search: 0,
    };
    rateLimitResetTime = Date.now() + rateLimitWindow;
    firstRequestTime = null;
}

// Helper function to fetch news data
async function fetchNewsData(apiKey, language, query, category, nextPage) {
    try {
        const response = await axios.get(`https://newsdata.io/api/1/latest`, {
            params: {
                apikey: apiKey,
                language: language,
                q: query,
                category: category,
                page: nextPage,
                country: country,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching data from API:', error.message);
        console.error('Error details:', error.response ? error.response.data : error.message);
        throw new Error('Failed to fetch data');
    }
}

// Endpoint to get latest news in Telugu
app.get('/telugu/news', async (req, res) => {
    await handleNewsRequest(req, res, apiKeys.telugu, 'te', 'telugu');
});

// Endpoint to get latest news in English
app.get('/english/news', async (req, res) => {
    await handleNewsRequest(req, res, apiKeys.english, 'en', 'english');
});

// Endpoint to search news
app.get('/search', async (req, res) => {
    apiRequestCount++;
    console.log(`Total requests to /search endpoint: ${apiRequestCount}`);

    const query = req.query.q; // Get the search query
    const language = req.query.language || 'te'; // Default to 'en' if no language is provided
    const category = req.query.category; // Get the category parameter if provided
    const nextPage = req.query.page; // Get the page parameter if provided
    const cacheKey = nextPage ? `search-${language}-${query}-${category}-page-${nextPage}` : `search-${language}-${query}-${category}`;
    let cachedData = cache.get(cacheKey);

    if (cachedData) {
        console.log('Serving from cache');
        return res.json(cachedData);
    }

    // Check if rate limit has been reached
    if (originalApiRequestCounts.search >= rateLimit) {
        const timeRemaining = rateLimitResetTime - Date.now();
        if (timeRemaining > 0) {
            console.log(`Rate limit reached. Please try again in ${timeRemaining / 1000} seconds.`);
            return res.status(429).json({ error: 'Rate limit reached. Please try again later.' });
        } else {
            resetRateLimit();
        }
    }

    try {
        originalApiRequestCounts.search++;
        console.log(`Total requests to original API: ${originalApiRequestCounts.search}`);

        const data = await fetchNewsData(apiKeys.search, language, query, category, nextPage);
        cache.set(cacheKey, data); // Store data in cache
        console.log('Serving from API and caching');
        return res.json(data);
    } catch (error) {
        console.error('Error fetching data from API:', error.message);
        console.error('Error details:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Helper function to handle news requests
async function handleNewsRequest(req, res, apiKey, language, apiKeyType) {
    apiRequestCount++;
    console.log(`Total requests to /news endpoint: ${apiRequestCount}`);

    const nextPage = req.query.page; // Get the page parameter if provided
    const cacheKey = nextPage ? `news-${language}-page-${nextPage}` : `news-${language}`;
    let cachedData = cache.get(cacheKey);

    if (cachedData) {
        console.log('Serving from cache');
        return res.json(cachedData);
    }

    // Check if rate limit has been reached
    if (originalApiRequestCounts[apiKeyType] >= rateLimit) {
        const timeRemaining = rateLimitResetTime - Date.now();
        if (timeRemaining > 0) {
            console.log(`Rate limit reached. Please try again in ${timeRemaining / 1000} seconds.`);
            return res.status(429).json({ error: 'Rate limit reached. Please try again later.' });
        } else {
            resetRateLimit();
        }
    }

    try {
        originalApiRequestCounts[apiKeyType]++;
        console.log(`Total requests to original API: ${originalApiRequestCounts[apiKeyType]}`);

        const data = await fetchNewsData(apiKey, language, null, null, nextPage);
        cache.set(cacheKey, data); // Store data in cache
        console.log('Serving from API and caching');
        return res.json(data);
    } catch (error) {
        console.error('Error fetching data from API:', error.message);
        console.error('Error details:', error.response ? error.response.data : error.message);
        return res.status(500).json({ error: 'Failed to fetch data' });
    }
}

// Endpoint to get rate limit information
app.get('/rate-limit', (req, res) => {
    const timeElapsed = firstRequestTime ? Date.now() - firstRequestTime : 0;
    const timeRemaining = rateLimitWindow - timeElapsed;

    const rateLimitInfo = {
        Teluguapi: {
            teluguApiRequests: originalApiRequestCounts.telugu,
            OriginalApiRequestsRemaining: rateLimit - originalApiRequestCounts.telugu,
            TimeRemaining: timeRemaining / 1000, // Convert to seconds
        },
        Englishapi: {
            EnglishApiRequests: originalApiRequestCounts.english,
            OriginalApiRequestsRemaining: rateLimit - originalApiRequestCounts.english,
            TimeRemaining: timeRemaining / 1000, // Convert to seconds
        },
        SearchApi: {
            SearchApiRequests: originalApiRequestCounts.search,
            OriginalApiRequestsRemaining: rateLimit - originalApiRequestCounts.search,
            TimeRemaining: timeRemaining / 1000, // Convert to seconds
        },
    };

    res.json(rateLimitInfo);
});

// Endpoint to get top news
app.get('/topnews', async (req, res) => {
    try {
        const response = await axios.get('https://tv9telugu.com/wp-json/tv9/v1/top9new');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch news data' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
