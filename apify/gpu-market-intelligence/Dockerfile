FROM apify/actor-node:20

COPY package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --no-audit --no-fund \
    && echo "Node modules installed"

COPY . ./

CMD npm start --silent
