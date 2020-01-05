# `slp-wii-connect`

[![npm version](http://img.shields.io/npm/v/@vinceau/slp-wii-connect.svg?style=flat)](https://npmjs.org/package/@vinceau/slp-wii-connect "View this project on npm")
[![Build Status](https://github.com/vinceau/slp-wii-connect/workflows/build/badge.svg)](https://github.com/vinceau/slp-wii-connect/actions?workflow=build)

> Extract Slippi data directly from the console or from a Slippi relay

This library provides methods for reading raw [Slippi](https://github.com/project-slippi/project-slippi) data directly from the console or relay.

## Installation

**With NPM**

```bash
npm install @vinceau/slp-wii-connect
```

**With Yarn**

```bash
yarn add @vinceau/slp-wii-connect
```

## Usage

```javascript
const { ConsoleConnection } = require("@vinceau/slp-wii-connect");

const connection = new ConsoleConnection();
connection.connect(address, port);

connection.on("data", (data) => {
  // Received data from console
  console.log(data);
});

connection.on("statusChange", (status) => {
  console.log(`status changed: ${status}`);
});
```

## License

This software is released under the terms of the MIT license.

