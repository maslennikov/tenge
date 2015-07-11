'use strict';

var expect = require('chai').expect;
var _ = require('lodash');
var F = require('flowy');
var config = require('./config.js');
var Tenge = require('../index.js');
var shortid = require('shortid');


describe('Tenge', function() {
    Tenge.connect(config.mongo);
    var model;
    var bobAndFriends = [
        {name: 'Bob', age: 17}, {name: 'Alice', age: 17},
        {name: 'Chris', age: 17}, {name: 'Paul', age: 16},
        {name: 'Waldo', age: 20},
    ];

    before(function() {
        expect(function() {new Tenge()}).to.throw(/No collection/);
    });

    beforeEach(function(done) {
        model = new Tenge({collection: 'dummy'});
        expect(model._getDb()).to.exist;
        expect(model._getCollection()).to.exist;

        F(function() {
            model._getCollection().remove({}, this.slot());
        }, function(err) {
            model.insert({doc: bobAndFriends}, this.slot());
        }, done);
    });

    it('should adhere to limits properly', function(done) {
        var bobAndCo = _.sortBy(bobAndFriends, 'name');

        F(function() {
            model.find({sort: {name: 1}}, this.slot());
            model.find({sort: {name: 1}, limit: 3}, this.slot());
            model.find({sort: {name: 1}, limit:3, skip: 2}, this.slot());
            model.findOne({sort: {name: 1}}, this.slot());

        }, function(err, all, limit, skip, one) {
            expect(all).to.be.eql(bobAndCo);
            expect(limit).to.be.eql(bobAndCo.slice(0, 3));
            expect(skip).to.be.eql(bobAndCo.slice(2, 5));
            expect(one).to.be.eql(all[0]);
            this.pass(null);

        }, done);
    });

    it('should show correct counts', function(done) {
        var bobAndCo = _.sortBy(bobAndFriends, 'name');

        F(function() {
            model.count({}, this.slot());
            model.count({limit: 3}, this.slot());
            model.count({limit:3, skip: 2}, this.slot());
            model.count({query: {name: 'Alice'}}, this.slot());

        }, function(err, all1, all2, all3, one) {
            expect(one).to.be.equal(1);
            expect(all1).to.be.equal(all2)
                .and.to.be.equal(all3)
                .and.to.be.equal(bobAndCo.length);

            model.size({}, this.slot());
            model.size({limit: 3}, this.slot());
            model.size({limit:3, skip: 2}, this.slot());
            model.size({query: {name: 'Alice'}}, this.slot());

        }, function(err, all, three1, three2, one) {
            expect(all).to.be.equal(bobAndCo.length);
            expect(three1).to.be.equal(three2).and.to.be.equal(3);
            expect(one).to.be.equal(1);
            this.pass(null);

        }, done);
    });

    it('should insert properly', function(done) {
        var doc = {name: 'Alex', age: 25};
        var docs = [
            {name: 'Mark', age: 40},
            {name: 'David', age: 5}
        ];

        F(function() {
            model.count({}, this.slot());

        }, function(err, count) {
            this.pass(count);
            model.insert({doc: doc}, this.slot());
            model.insert({doc: docs}, this.slot());

        }, function(err, oldcnt, newDoc, newDocs) {
            //original docs were modified in-place
            expect(doc).to.be.eql(newDoc).and.to.have.property('_id');
            expect(newDocs).to.have.length(docs.length);
            expect(_.every(newDocs, '_id'));
            expect(docs).to.be.eql(newDocs);

            this.pass(oldcnt);
            model.find().count(this.slot());

        }, function(err, oldcnt, newcnt) {
            expect(newcnt).to.equal(oldcnt + 1 + docs.length);
            this.pass(null);

        }, done);
    });

    it('should handle before- and after-insert hook', function(done) {
        model.before('insert', function(doc, next) {
            doc.name += '-Dieter';
            next();
        });
        model.after('insert', function(doc, next) {
            expect(doc).to.have.property('name', 'Hans-Dieter');
            expect(doc).to.have.property('_id');
            doc.modifiedAfter = true;
            next();
        });
        model.insert({doc: {name: 'Hans'}}, function(err, doc) {
            expect(err).not.to.exist;
            expect(doc).to.have.property('name', 'Hans-Dieter');
            expect(doc).to.have.property('modifiedAfter', true);
            done();
        });
    });

    it('should update single doc properly', function(done) {
        var params = {
            query: {age: 17},
            sort: {name: 1},
            update: {$set: {hobby: 'chess'}}
        };

        F(function() {
            model.find(params, this.slot());
            model.updateOne(params, this.slot());

        }, function(err, all, updated) {
            expect(all).to.have.length.above(1);
            expect(_.defaults({}, all[0], updated)).to.be.eql(updated);

            //now check the actual state
            this.pass(updated);
            model.find({}, this.slot());

        }, function(err, updated, all) {
            var doc = _.where(all, {_id: updated._id})[0];
            expect(doc).to.be.eql(updated);
            expect(_.compact(_.pluck(all, 'hobby'))).to.have.length(1);
            this.pass(null);

        }, done);
    });

    it('should update multiple docs properly', function(done) {
        var params = {
            query: {age: {$lt: 20}},
            sort: {name: -1},
            update: {$set: {hobby: 'chess'}}
        };

        F(function() {
            model.find(params, this.slot());
            model.updateAll(params, this.slot());

        }, function(err, all, updated) {
            expect(all).to.have.length.above(1);
            expect(all).to.have.length(updated.length);
            expect(_.compact(_.pluck(updated, 'hobby')))
                .to.have.length(all.length);
            expect(_.pluck(all, '_id')).to.be.eql(_.pluck(updated, '_id'));

            //now check the actual state
            this.pass(updated);
            model.find({}, this.slot());

        }, function(err, updated, all) {
            expect(_.compact(_.pluck(all, 'hobby')))
                .to.have.length(updated.length);
            this.pass(null);

        }, done);
    });

    it('shoud transform special queries', function() {
        var params, modified;

        function transform(params) {
            var paramsOrig = _.cloneDeep(params);
            var modified = model._makeQuery(params);
            expect(paramsOrig).to.be.eql(params);
            return modified;
        }

        params = {query: {$$: {id: "NkXtJhvB"}}};
        modified = transform(params);
        expect(modified).to.be.eql({query: {id: params.query.$$.id}});

        params = {query: {$$: {
            ids: ["NkXtJhvB", "V1GQFknvH"]
        }}};
        modified = transform(params);
        expect(modified).to.be.eql({query: {id: {$in: params.query.$$.ids}}});

        //testing the merge
        params = {query: {name: 'Alice', $$: {id: "V1GQFknvH"}}};
        modified = transform(params);
        expect(modified).to.be.eql({query: {
            name: 'Alice',
            id: params.query.$$.id
        }});

        //testing invalid $$-key
        params = {query: {$$: {blupp: "55694ef8a8d8596e1b0d8830"}}};
        expect(function() {transform(params)}).to.throw(/No query transformer/);

        //conflicting $$-keys silently overwrite each other
        params = {query: {$$: {
            id: "NkXtJhvB",
            ids: ["55694ef8a8d8596e1b0d8830", "5568807f840cf93a0bc08514"]
        }}};
        modified = transform(params);
        expect(modified).to.be.eql({query: {
            id: {$in: params.query.$$.ids}}});
    });

    it('should execute any hooks properly', function(done) {
        var hooks = [
            function(params, next) {params.push(1); next()},
            function(params, next) {params.push(2); next()},
            function(params, next) {params.push(3); next('error')},
            function(params, next) {params.push(4); next()}
        ];

        var params = [];
        model._runHooks(hooks, params, function(err, result) {
            expect(err).to.equal('error');
            expect(result).to.be.equal(params)
                .and.to.be.eql([1,2,3]);

            done();
        });
    });

    it('should create custom id', function(done) {
        F(function() {
            model.insert({doc: [
                {bob: 'marley'}, {jimi: 'hendrix'}, {carlos: 'santana'}
            ]}, this.slot());

        }, function(err, docs) {
            _.each(docs, function(doc) {
                expect(doc).to.have.property('_id');
                expect(shortid.isValid(doc.id)).to.be.true;
            });
            expect(_.unique(_.pluck(docs, 'id'))).to.have.length(docs.length);
            this.pass(null);

        }, done);
    });
});
