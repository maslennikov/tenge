'use strict';

var expect = require('chai').expect;
var _ = require('lodash');
var F = require('flowy');
var config = require('./config.js');
var Tenge = require('../index.js');
var shortid = require('shortid');


describe('Tenge', function() {
    var model;
    var bobAndFriends = [
        {name: 'Bob', age: 17}, {name: 'Alice', age: 17},
        {name: 'Chris', age: 17}, {name: 'Paul', age: 16},
        {name: 'Waldo', age: 20},
    ];

    before(function() {
        expect(Tenge._db).to.throw(/Not connected/);
        Tenge.connect(config.mongo);
        expect(Tenge._db()).to.exist;
    });

    beforeEach(function(done) {
        var modelOpts = {collection: 'unittests'};

        F(function() {
            Tenge._db().getCollectionNames(this.slot());

        }, function(err, collections) {
            if (collections.indexOf(modelOpts.collection) < 0) {
                this.pass();
            } else {
                Tenge._db().collection(modelOpts.collection).drop(this.slot());
            }

        }, function(err) {
            Tenge._db().createCollection('unittests', this.slot());


        }, function(err) {
            //checking how constructor creates index
            model = new Tenge(modelOpts);
            model._collection(this.slot());

        }, function(err, col) {
            col.getIndexes(this.slot());

        },  function(err, indexes) {
            expect(_.find(indexes, {key: {id: 1}, unique: true})).to.exist;
            model.insert({docs: bobAndFriends}, this.slot());
        }, done);
    });

    it('should fail to do collection operations without collection name', function(done) {
        F(function() {
            var m = new Tenge({});
            m._collection(this.slot());
        }, function(err, col) {
            expect(err).to.match(/No collection/);
            done();
        });
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
            model.insert({docs: docs}, this.slot());

        }, function(err, oldcnt, newDoc, newDocs) {
            expect(newDoc).to.have.length(1);
            //original docs were modified in-place
            expect(doc).to.be.eql(newDoc[0]).and.to.have.property('_id');
            expect(newDocs).to.have.length(docs.length);
            expect(_.every(newDocs, '_id'));
            expect(docs).to.be.eql(newDocs);

            this.pass(oldcnt);
            model.count({}, this.slot());

        }, function(err, oldcnt, newcnt) {
            expect(newcnt).to.equal(oldcnt + 1 + docs.length);
            this.pass(null);

        }, done);
    });

    it('should insert doc and docs', function(done) {
        var doc = {name: 'Alex', age: 25};
        var docs = [
            {name: 'Mark', age: 40},
            {name: 'David', age: 5}
        ];

        F(function() {
            model.insert({doc: doc, docs: docs}, this.slot());

        }, function(err, newDocs) {
            expect(newDocs).to.have.length(docs.length + 1);
            expect(_.every(newDocs, '_id'));

            model.find({}, this.slot());

        }, function(err, all) {
            expect(_.intersection(docs.concat(doc)), all)
                .to.have.length(docs.length + 1);
            this.pass(null);

        }, done);
    });

    it('should handle before- and after-insert hook', function(done) {
        model.before('insert', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.name += '-Dieter';
            });
            next();
        });
        model.after('insert', function(params, next) {
            _.each(params.docs, function(doc) {
                expect(doc.name).to.match(/-Dieter$/);
                expect(doc).to.have.property('_id');
                doc.modifiedAfter = true;
            });
            next();
        });
        model.insert({doc: {name: 'Hans'}}, function(err, docs) {
            expect(err).not.to.exist;
            expect(docs).to.have.length(1);
            expect(docs[0]).to.have.property('name', 'Hans-Dieter');
            expect(docs[0]).to.have.property('modifiedAfter', true);
            done();
        });
    });

    it('should remove multiple documents', function(done) {
        var params = {query: {age: 17}};

        F(function() {
            model.remove(params, this.slot());

        }, function(err, removed) {
            expect(removed).to.have.length.above(1);
            expect(_.every(removed, {age: 17})).to.be.true;

            //now check the actual state
            model.find({}, this.slot());

        }, function(err, all) {
            expect(_.some(all, {age: 17})).to.be.false;
            this.pass(null);

        }, done);
    });

    it('should not remove not matched documents', function(done) {
        var params = {query: {age: 177}};

        F(function() {
            model.remove(params, this.slot());

        }, function(err, removed) {
            expect(removed).to.be.empty;

            //now check the actual state
            model.find({}, this.slot());

        }, function(err, all) {
            expect(all).to.be.eql(bobAndFriends);
            this.pass(null);

        }, done);
    });

    it('should limit count of removed documents', function(done) {
        var params = {query: {age: 17}, limit: 1};

        F(function() {
            model.remove(params, this.slot());

        }, function(err, removed) {
            expect(removed).to.have.length(1);
            this.pass(removed);

            //now check the actual state
            model.find({}, this.slot());

        }, function(err, removed, all) {
            expect(_.some(all, params.query)).to.be.true;
            expect(_.some(all, {_id: removed[0]._id})).to.be.false;
            this.pass(null);

        }, done);
    });

    it('should handle before- and after-remove hook', function(done) {
        var params = {query: {age: 17}, fields: {_id: true}};

        model.before('remove', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.modifiedBefore = true;
            });
            //checking that only modified docs will be applied to the remove OP
            params.docs = params.docs.slice(0, 2);
            next();
        });

        model.after('remove', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.modifiedAfter = true;
            });
            next();
        });


        F(function() {
            model.remove(params, this.slot());

        }, function(err, removed) {
            this.pass(removed);
            model.find(params, this.slot());

        }, function(err, removed, fetched) {
            expect(err).not.to.exist;
            expect(removed).to.have.length(2);
            expect(_.every(removed, 'modifiedBefore'));
            expect(_.every(removed, 'modifiedAfter'));

            expect(fetched).to.have.length(1);
            expect(_.some(removed, fetched[0])).to.be.false;
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

    it('should fail to updateOne an unexisting doc', function(done) {
        F(function() {
            model.updateOne({
                query: {age: 150},
                update: {$set: {hobby: 'levitate'}}
            }, this.slot());
        }, function(err, doc) {
            expect(err).to.exist;
            done();
        });
    });

     it('should handle milti update of unexisting docs', function(done) {
         F(function() {
             model.updateAll({
                 query: {age: 150},
                 update: {$set: {hobby: 'levitate'}}
             }, this.slot());
         }, function(err, docs) {
             expect(err).not.to.exist;
             expect(docs).to.eql([]);
             done();
         });
    });

    it('should upsert an unexisting doc via updateOne', function(done) {
        var params = {
            query: {age: 150},
            update: {$set: {hobby: 'levitate'}},
            upsert: true
        };

         F(function() {
             model.updateOne(params, this.slot());
         }, function(err, doc) {
             expect(err).not.to.exist;
             expect(doc).to.include.keys(_.extend({}, params.query, params.update.$set));
             expect(doc).to.have.property('_id');

             done();
         });
    });

    it('should trigger after-update hook from updateOne', function(done) {
        model.after('update', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.modifiedAfter = true;
            });
            next();
        });

        var params = {
            query: {age: 16},
            update: {$set: {hobby: 'sports'}}
        };

         F(function() {
             model.updateOne(params, this.slot());
         }, function(err, doc) {
             expect(err).not.to.exist;
             expect(doc).to.have.property('modifiedAfter', true);

             done();
         });
    });

        it('should trigger after-update hook from updateAll', function(done) {
        model.after('update', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.modifiedAfter = true;
            });
            next();
        });

        var params = {
            query: {age: 17},
            update: {$set: {hobby: 'reading'}}
        };

         F(function() {
             model.updateAll(params, this.slot());
         }, function(err, docs) {
             expect(err).not.to.exist;
             expect(docs).to.have.length(3);
             expect(_.every(docs, 'modifiedAfter'));

             done();
         });
    });


    it('should trigger after-upsert hook from updateOne', function(done) {
        model.after('upsert', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.modifiedAfter = true;
            });
            next();
        });

        var params = {
            query: {age: 150},
            update: {$set: {hobby: 'levitate'}},
            upsert: true
        };

         F(function() {
             model.updateOne(params, this.slot());
         }, function(err, doc) {
             expect(err).not.to.exist;
             expect(doc).to.include.keys(_.extend({}, params.query, params.update.$set));
             expect(doc).to.have.property('modifiedAfter', true);
             expect(doc).to.have.property('_id');

             done();
         });
    });

    it('should trigger after-upsert hook from updateAll', function(done) {
        model.after('upsert', function(params, next) {
            _.each(params.docs, function(doc) {
                doc.modifiedAfter = true;
            });
            next();
        });

        var params = {
            query: {age: 150},
            update: {$set: {hobby: 'levitate'}},
            upsert: true
        };

         F(function() {
             model.updateAll(params, this.slot());
         }, function(err, docs) {
             expect(err).not.to.exist;
             expect(docs).to.have.length(1);
             expect(docs[0]).to.include.keys(_.extend({}, params.query, params.update.$set));
             expect(docs[0]).to.have.property('modifiedAfter', true);
             expect(docs[0]).to.have.property('_id');

             done();
         });
    });

    it('should upsert an unexisting doc via updateAll', function(done) {
        var params = {
            query: {age: 150},
            update: {$set: {hobby: 'levitate'}},
            upsert: true
        };

         F(function() {
             model.updateAll(params, this.slot());
         }, function(err, docs) {
             expect(err).not.to.exist;
             expect(docs).to.have.length(1);
             expect(docs[0]).to.include.keys(_.extend({}, params.query, params.update.$set));
             expect(docs[0]).to.have.property('_id');

             done();
         });
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

    it('should have hooks mechanism run properly', function(done) {
        var hooks = [
            function(params, next) {params.docs.push(1); next()},
            function(params, next) {params.docs.push(2); next()},
            function(params, next) {params.docs.push(3); next('error')},
            function(params, next) {params.docs.push(4); next()}
        ];

        var docs = [];
        model._runHooks(hooks, docs, function(err, result) {
            expect(err).to.equal('error');
            expect(result).to.be.equal(docs).and.to.be.eql([1,2,3]);

            done();
        });
    });

    it('should create custom id', function(done) {
        F(function() {
            model.insert({docs: [
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

    it('should not allow duplicate custom ids', function(done) {
        F(function() {
            var id = 'fake_id';
            var docs = [
                {bob: 'marley'}, {jimi: 'hendrix'}, {carlos: 'santana'}
            ].map(function(doc) {
                return _.extend(doc, {id: id});
            });

            model.insert({docs: docs}, this.slot());
        }, function(err, docs) {
            expect(err).to.exist;

            model.count({query: {id: 'fake_id'}}, function(err, count) {
                //it should have been a duplicate key error
                expect(count).to.equal(1);
                done(err);
            });
        });
    });

    it ('should produce correct error messages', function() {
        expect(model._assert(true, 'not occurs')).to.not.exist;
        expect(function(){model._assert(false, 'occurs')})
            .to.throw('Tenge: occurs');
    });
});
