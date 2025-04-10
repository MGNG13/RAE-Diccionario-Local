from difflib import get_close_matches
from flask import Flask, request
from flask_cors import CORS
from json import load, dumps
import pandas as pd


app = Flask(__name__)
CORS(app, resources={r"/*": {
    "origins": "*", 
    "methods": ["GET", "POST", "OPTIONS"], 
    "allow_headers": ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
    "expose_headers": ["Content-Type", "Authorization"],
    "supports_credentials": True,
    "max_age": 3600
}})

# Add a route to handle preflight requests for all endpoints
@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    response = app.response_class(
        response="",
        status=200
    )
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept, Origin, X-Requested-With'
    response.headers['Access-Control-Max-Age'] = '3600'
    return response

# Inicializar caché en memoria
cache = {}

def check_and_clear_cache():
    if len(cache) >= 10000:
        cache.clear()

# Load the Spanish dictionary dataset
with open('dataset_spanish.json', 'r', encoding='utf-8') as f:
    raw_data = load(f)

# Convert the data into a list of dictionaries with consistent structure
processed_data = []
for word, meaning in raw_data.items():
    processed_data.append({
        'word': word,
        'meaning': meaning
    })

# Convert to pandas DataFrame for efficient lookups
df = pd.DataFrame(processed_data)
@app.route('/<text>', methods=['GET', 'OPTIONS'])
def get_word_meaning(text):
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = app.response_class(
            response="",
            status=200
        )
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept, Origin, X-Requested-With'
        response.headers['Access-Control-Max-Age'] = '3600'
        return response
    try:
        # Case-insensitive search
        text = text.lower()
        # Find the word in the DataFrame
        # Verificar caché
        if text in cache:
            return app.response_class(
                response=dumps(cache[text], ensure_ascii=False),
                status=200,
                mimetype='application/json; charset=utf-8'
            )
        # Buscar en DataFrame
        word_data = df[df['word'].str.lower() == text].iloc[0].to_dict()
        response_data = {
            'ok': True,
            'data': [word_data]
        }
        # Verificar y limpiar caché si es necesario
        check_and_clear_cache()
        # Almacenar en caché
        cache[text] = response_data
        return app.response_class(
            response=dumps(response_data, ensure_ascii=False),
            status=200,
            mimetype='application/json; charset=utf-8'
        )
    except (IndexError, KeyError):
        # Buscar palabra similar
        palabras = df['word'].str.lower().tolist()
        coincidencias = get_close_matches(text, palabras, n=3, cutoff=0.6)
        if coincidencias:
            response_data = {
                'ok': True,
                'data': [df[df['word'].str.lower() == palabra].iloc[0].to_dict() for palabra in coincidencias]
            }
            # Verificar y limpiar caché si es necesario
            check_and_clear_cache()
            cache[text] = response_data
            return app.response_class(
                response=dumps(response_data, ensure_ascii=False),
                status=200,
                mimetype='application/json; charset=utf-8'
            )
        response_data = {'ok': False, 'data': ''}
        cache[text] = response_data
        return app.response_class(
            response=dumps(response_data, ensure_ascii=False),
            status=404,
            mimetype='application/json; charset=utf-8'
        )
    except Exception as e:
        response_data = {'ok': False, 'error': str(e)}
        cache[text] = response_data
        return app.response_class(
            response=dumps(response_data, ensure_ascii=False),
            status=500,
            mimetype='application/json; charset=utf-8'
        )

@app.errorhandler(404)
def handle_404(e):
    return app.response_class(
        response=dumps({'ok': False, 'data': ''}, ensure_ascii=False),
        status=404,
        mimetype='application/json; charset=utf-8'
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)