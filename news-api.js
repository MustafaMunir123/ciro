const { getJson } = require("serpapi");

getJson({
    documentation_path: "/google-news-light-api",
    api_key: NEWS_API_KEY,
    engine: "google_news_light",
    no_cache: "true",
    date: "01-08-2025",
    q: "shahra e bhutto flood",
    google_domain: "google.com",
    safe: "off",
    filter: "0"
}, (json) => {
    console.log(json);
});

//   https://serpapi.com/playground?engine=google_news_light&q=shahra+e+bhutto+flood&safe=off&filter=0&no_cache=true&date=01-08-2025&newPara=date


