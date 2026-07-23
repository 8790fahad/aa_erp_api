# FROM mhart/alpine-node:9 AS build
FROM stefanscherer/node-windows:7.6.0-nano as build
WORKDIR /srv
ADD package.json .
RUN npm install
ADD . .

FROM stefanscherer/node-windows:7.6.0-nano
COPY --from=build /srv .
EXPOSE 5000
CMD ["node", "app.js"]