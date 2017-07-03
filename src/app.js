"use strict";

const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const elasticSearch = require('elasticsearch');

let host = process.env.ESHOST || '127.0.0.1:9200';

const esClient = new elasticSearch.Client({
    host: host,
    log: 'error'
});

esClient.ping({
    requestTimeout: 30000,
}, function (error) {
    if (error) {
        console.error('Elasticsearch cluster is down!');
    } else {
        console.log('ElasticSearch running at ' + host);
    }
});

const bulkIndex = require('./modules/bulkIndex');
// const searchIndex = require('./modules/searchAll');
const stdMethods = require('./modules/stdMethods');

const app = express();

// view engine setup
// app.set('views', path.join(__dirname, 'views'));
// app.set('view engine', 'pug');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
// app.use(cookieParser());
//app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 8080;
const router = express.Router();

// CREATE ROUTING FOR THE API
router.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    next(); // make sure we go to the next routes and don't stop here
});

// Parse location data
router.use(function (req, res, next) {
    
    if(req.query['location']){
        req.query['location'] = req.query['location'].split(",");
    }
    console.log("Parsed Location")
    next(); // make sure we go to the next routes and don't stop here
});

// Parse time data
router.use(function (req, res, next) {
    
    if(req.query['time']){
        req.query['time'] = req.query['time'].split(",");
    }
    console.log("Parsed Time")
    next(); // make sure we go to the next routes and don't stop here
});

router.get('/', function (req, res) {
    // TODO index.html
    let answer = '<h1>Elasticsearch API is running</h1>' +
        '<p>Possible API calls:</p>' +
        '<ul><li>/api/indices</li>' +
        '<li>/api/indices/<i>indexName</i></li>' +
        '<li>/api/indices/<i>indexName</i>/docs/<i>docId</i></li>' +
        '<li>/api/indices/<i>indexName</i>/suggest/<i>input</i></li></ul>'
    res.send(answer);
});

router.route('/indices')

    // Show all indexes
    .get(function (req, res) {
        esClient.cat.indices({
            format: 'json'
        })
            .then(function (result) {
                res.json(result.map(d => {
                    return {
                        "name": d.index,
                        "health": d.health
                        //TODO primary size
                    };

                }));
            })
            .catch(err => console.error(`Error connecting to the es client: ${err}`));
    });

router.route('/indices/:indexName')

    .get(function (req, res) {
        esClient.search({
            index: req.params.indexName,
            size: 10000,
            body: {
                sort: [{ "timestamp": { "order": "desc" } }],
                query: { match_all: {} }
            }
        })
            .then(function (result) {
                res.json(result.hits.hits.map(d => d._source));
            })
            .catch(err => console.error(`Error connecting to the es client: ${err}`));
    });


router.route('/indices/:indexName/bucket/:time/agr/:type')
    .get(function (req, res) {  
        let timeGte = "new-1h/m"
        let timeLte = "new/m"
        if(req.query["time"] && req.query["time"].length === 2){
            timeGte = req.query["time"][0];
            timeLte = req.query["time"][1];

        }
        let jsonVar = {        
            index: req.params.indexName,        
            size: 0,    
            body: {
               
                 "query": {
                    "constant_score": {
                        "filter": {
                            "range": {
                                "timestamp": {
                                    "gte": timeGte,
                                    "lte": timeLte
                                }
                            }
                        }
                    }
                 },
                sort: [{ "timestamp": { "order": "desc" } }],
                "aggs": {
                        "agg_per_time": {
                        "date_histogram": {
                            "field": "timestamp",
                            "interval": req.params.time
                        },
                        "aggs": {
                            "type": {
                            [req.params.type] : {
                                "field": "sensors.temperature.observation_value"
                            }
                            }
                        }
                    }
                }
                
            },
            
        }              
        if(req.query["location"] && req.query["location"].length === 4){
            if(!jsonVar.body.query.constant_score.filter["bool"]){
                let range = jsonVar.body.query.constant_score.filter;
                jsonVar.body.query.constant_score.filter = {
                    "bool":{
                        "must":[]
                    }
                }
                jsonVar.body.query.constant_score.filter.bool.must.push(range);
            }
            jsonVar.body.query.constant_score.filter.bool.must.push({       
                "geo_bounding_box":      {
                    "location": {
                        "top_left": {
                            "lat":  req.query["location"][0],
                            "lon":  req.query["location"][1],
                            },
                        "bottom_right": {
                            "lat":  req.query["location"][2],
                            "lon":  req.query["location"][3],
                        }
                    }
                    

                }
            });

        }
        console.log(JSON.stringify(jsonVar, null, 2));
        
        
        esClient.search(jsonVar)
            .then(function (result) {
                res.json(result.aggregations.agg_per_time.buckets.map(d =>{
                    return {
                        timestamp: d.key_as_string,
                        value: d.type.value
                    }
                }));
            })
            
            .catch(err => console.error(`Error connecting to the es client: ${err}`));
    });

// TODO make it work
router.route('/indices/:indexName/search')

    .post(function (req, res) {
        // esClient.search({
        //     index: req.params.indexName,
        //     size: 10000,
        //     body: {
        //         sort: [{"timestamp": { "order": "desc" } }],
        //         query: req.body
        //             /*{
        //             match: {
        //                 field: field user input,
        //                 field2: input ...
        //             }
        //             }
        //              */
        //     }
        // })
        console.log('POST Hurra! ' + req.body);
    });
    // .then(function(result) {
    //     res.redirect('/');
    // })
    // .catch(err => console.error(`Error connecting to the es client: ${err}`));

router.route('/indices/:indexName/docs/:docId')

    // Check for doc with given Id, if exists in given index!
    .get(function (req, res) {
        //console.log('Looking for index ' + req.params.indexName);
        //esClient.indices.get(req.params.indexName)
        esClient.exists({
            index: req.params.indexName,
            type: '_all',
            id: req.params.docId
        })
            .then(function (result) {
                res.json(result);
            })
            .catch(err => console.error(`Error connecting to the es client: ${err}`));
    });

router.route('/indices/:indexName/suggest/:input')

    // Get suggestions
    .get(function (req, res) {
        esClient.suggest({
            index: req.params.indexName,
            type: '_all',
            body: {
                docsuggest: {
                    text: req.params.input,
                    completion: {
                        field: 'suggest',
                        fuzzy: true
                    }
                }
            }
        })
            .then(function (result) {
                res.json(result);
            })
            .catch(err => console.error('Error connecting to the es client: ${err}'));
    });

router.route('/test')

    // Filled the DB with testdata
    .get(function (req, res) {
        bulkIndex.bulkIndexGen("weather", "daten", 10000);
        res.end();

        //return JSON.        
    });




// REGISTER ALL ROUTES
// all of our routes will be prefixed with /api
app.use('/api', router);
app.use('/', express.static('dist'));


app.listen(port);
console.log('Server running on port ' + port);