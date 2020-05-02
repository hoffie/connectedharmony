An asynchronous multi-track audio/video recording web application.

This web application can be used to create virtual choirs.
This is helpful in times where people cannot meet freely as they want, such as in CoViD-2019 times where social distancing is a thing.

## Requirements for musicians
A modern browser (HTML5/JavaScript/CSS) with network connectivity to the server. Tested with Firefox 75 and Chromium 81.

## Status & Limitations
- The frontend, i.e. recording part, is considered more or less feature complete.
- Currently, there is no backend support. Recorded files have to be merged manually. It is planned to support automatic merging.
- Currently, there is no administration support. New projects have to be created by running an SQL query. Support for an administration interface is planned.
- German-only: In case someone wants to add support for multi-language support, pull requests will be accepted.

## Tech stack
The backend is written in [Golang](https://golang.org), using [Gin](https://github.com/gin-gonic/gin) as web framework and [gorm](https://github.com/jinzhu/gorm) as object-relational mapper with an [SQLite](https://sqlite.org) backend.
The frontend uses [Vue](https://vuejs.org) with [Vue-Router](https://router.vuejs.org) and [Vuetify](https://vuetifyjs.com/).
Recording support is provided by [RecordRTC](https://github.com/muaz-khan/RecordRTC/).

### Getting started
`git clone https://github.com/hoffie/connectedharmony && cd connectedharmony && make debug-run`

## License
This implementation is licensed under [AGPLv3](LICENSE.AGPLv3).

## Author
ConnectedHarmony was implemented by [Christian Hoffmann](https://hoffmann-christian.info) in 2020.
