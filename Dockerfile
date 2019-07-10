FROM node:10-alpine

COPY ./package.json /app/package.json
COPY ./node_modules /app/node_modules
COPY ./config /app/config
COPY ./dist /app/dist
COPY ./__BUILD_DATA__.json /app/__BUILD_DATA__.json
WORKDIR /app


CMD ["npm", "start"]
EXPOSE 4040

###########