
from flask import Flask, request, jsonify
import requests
from bs4 import BeautifulSoup

app = Flask(__name__)

@app.route("/", methods=["GET"])
def root():
    return "Sahab Scraper API is running!"

@app.route("/scrape", methods=["POST"])
def scrape():
    data = request.get_json()
    url = data.get("url")

    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        response = requests.get(url, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')

        # Sample extraction: title and meta description
        title = soup.title.string if soup.title else ""
        description_tag = soup.find("meta", attrs={"name": "description"})
        description = description_tag["content"] if description_tag else ""

        return jsonify({
            "title": title,
            "description": description,
            "url": url
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run()
