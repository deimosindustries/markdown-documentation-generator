#!/usr/bin/env node

"use strict";

var masterData = require('./lib/data-store');
var _sg        = require('./lib/globals'); //"Global" variables
var formatters = require('./lib/md-formats');
var sanitize   = require('./lib/sanitize');
var sorting    = require('./lib/sorts');
var tags       = require('./lib/tags').tags;
var template   = require('./lib/templating');

var chalk      = require('chalk');
var cheerio    = require('cheerio');
var fs         = require('fs-extra');
var hl         = require('highlight.js');
var _          = require('lodash');
var markdown   = require('marked');
var path       = require('path');
var walk       = require('walk');

//Default options
var options = {
    sgComment: 'SG',
    exampleIdentifier: 'html_example',
    sortCategories: true,
    sections: {
        "styles": '',
        "development": 'Dev:'
    },
    srcFolder: process.cwd(),
    excludeDirs: ['target', 'node_modules'],
    fileExtensions: {
        scss: true,
        sass: true,
        css: false,
        less: true,
        md: true
    },
    templateFile: path.join(_sg.moduleDir, '/template/template.hbs'),
    themeFile: path.join(_sg.moduleDir, '/template/theme.css'),
    outputFile: path.join(process.cwd(), '/styleguide/styleguide.html'),
    jsonOutput: false,
    handlebarsPartials: {
        utilities: path.join(_sg.moduleDir, '/template/utilities.js'),
        jquery: path.join(_sg.moduleDir, '/template/jquery.js'),
    },
    highlightStyle: 'arduino-light',
    highlightFolder: path.join(_sg.hljsDir, '../styles/'),
    customVariables: {
        scripts: ['',''],
        pageTitle: "Style Guide"
    },
    markedOptions: {
        gfm: true,
        breaks: true
    },
    walkerOptions: {
        followLinks: false
    }
};


//Set up identifiers
_sg.sgUniqueIdentifier   = 'md-sg';

//Set up system variables to be defined later
var customOptions,
    configFilePath,
    existingConfig,
    renderer;

/**
 * Generic file list console output
 *
 * @param {String} Arguments
 */
function listFiles(fileName, create) {

    if(create) {
        var time = sanitize.getTime();
        return console.info(_sg.good(_sg.logPre + 'Created File: ' + fileName) + chalk.grey(' ['+time+']'))
    }

    if(_sg.fileList){
        return console.info(_sg.logPre + 'Reading ' + _sg.info(fileName));
    }

}

var arg = {
    init: function(){
        configFilePath = path.join(process.cwd(), '.styleguide');

        try {
            existingConfig = fs.readFileSync(configFilePath, 'utf8');
        } catch(err) {
            fs.writeFileSync(configFilePath, JSON.stringify(options,null,'\t'));
            listFiles(configFilePath, true);
        }
        if (existingConfig !== 'undefined') {
            console.error(_sg.logPre + _sg.error(' Configuration file \'.styleguide\' already exists in this directory.'));
            console.warn(_sg.logPre + 'Edit that file, or delete it and run \'init\' again if you want to create a new configuration file.');
        }
        process.exit(0);
    },
    lf: function() {
        _sg.fileList = true;
    },
    help: function() {
        console.info('');
        console.info(chalk.blue('     _____                                         '));
        console.info(chalk.blue('    / ___/ _        / |                ( )   / |     '));
        console.info(chalk.blue('   | (___ | |_ _   _| | ___  __ _ _   _ _  __| | ___ '));
        console.info(chalk.blue('    \\___ \\| __| | | | |/ _ \\/ _` | | | | |/ _` |/ _ \\'));
        console.info(chalk.blue('    ____) | |_| |_| | |  __/ (_| | |_| | | (_| |  __/'));
        console.info(chalk.blue('    \\____/ \\___\\__, |_|\\___/\\__, |\\__,_|_|\\__,_|\\___/'));
        console.info(chalk.blue('                __/ |        __/ |                   '));
        console.info(chalk.blue('               |___/        |___/                    '));
        console.info('');
        console.info('   ' + _sg.info('md_documentation') + '         Generate styleguide');
        console.info('   ' + _sg.info('md_documentation init') + '    Create a new configuration file in the current directory');
        console.info('   ' + _sg.info('md_documentation lf') + '      Show "Reading [filename]" during file processing' );
        console.info('   ' + _sg.info('md_documentation help') + '    Show this');
        console.info('');
        console.info('   More help at');
        console.info('   https://github.com/UWHealth/markdown-documentation-generator');
        console.info('');
        process.exit(0);
    }
};

/**
 * Check arguments against arg object and run that method
 *
 * @param {Array} args - arguments
 */
function readArgs(args) {

    if (args.length > 0) {
        var curArg = args[0].toLowerCase();

        if(arg[curArg] !== 'undefined') {
            arg[curArg]();

        }else {
            console.info( _sg.logPre + curArg + ' not recognized. Showing help instead.');
            arg['help']();
        }
    }
}

/**
 * Read configuration
 */

function readConfig() {
    try {
        customOptions = fs.readFileSync('.styleguide', 'utf8');
    } catch(err) {
        console.info(_sg.logPre + 'No ".styleguide" configuration file found in current directory, using defaults');
    }
    if (customOptions !== 'undefined') {
        try {
            listFiles('.styleguide');
            customOptions = JSON.parse(customOptions);
        }
        catch(err) {
            console.error(_sg.logPre + _sg.error('Found ".styleguide", but could not read - is it valid json?'));
            console.error(err);
            process.exit(1);
        }

        //Overwrite default sections with custom ones if they exist
        options.sections = customOptions.sections;

        options = _.merge(options, customOptions);

        //Move customVariables options to JSON output
        masterData.customVariables = options.customVariables;

    }

    // Add walker exclude directories if set
    if(Object.prototype.toString.call(options.excludeDirs) === '[object Array]') {
        options.walkerOptions.filters = options.excludeDirs;
    }
}

/**
 * Read template/theme/highlight files
 *
 */
function readTheme() {
    try {
        _sg.templateSource = fs.readFileSync(options.templateFile, 'utf8');
        _sg.themeSource = fs.readFileSync(options.themeFile, 'utf8');
        _sg.highlightSource = fs.readFileSync(path.join(options.highlightFolder, options.highlightStyle + '.css'), 'utf8');
    }
    catch(err) {
        console.error(_sg.logPre + _sg.error('Could not read file: ' + err.path));
        process.exit(1);
    }
}

/**
 * Save html to file
 *
 * @param {String} html
 */
function saveFile(html) {
    fs.outputFile(options.outputFile, html, function(err, data) {
        if (err) {
            console.error(_sg.logPre + err);
            process.exit(1);
        }
        listFiles(options.outputFile, true);
    });
}

/**
 * Search through <category> tags for current section identifiers
 *
 * @param {Object} $article - article html loaded by cheerio
 * @return {Array} Section Name, Section identifier
 */
function findSection($article) {
    var currentSection;
    var currentIdentifier;
    var headerText = $article(tags.category).slice(0, 1).text() + $article(tags.article).text();

    //Check headings for identifiers declared in "sections" option
    for (var sectionName in options.sections){
        if ({}.hasOwnProperty.call(options.sections, sectionName)) {
            currentIdentifier = options.sections[sectionName];

            if(headerText.indexOf(currentIdentifier) > -1 && currentIdentifier !== ''){
                currentSection = sectionName;
                break;
            }
        }
    }

    if (_.isUndefined(currentSection)){
        currentSection = _sg.defaultSection;
        currentIdentifier = '';
    }

    return [currentSection, currentIdentifier];
}

/**
 * Search through <category> tags for current section identifiers
 *
 * @param {Object} $article - article html loaded by cheerio
 * @return {Array} Section Name, Section identifier
 */
function createSectionStructure() {
    var structure = {};
    //Create section object for data structure, based on user's "sections" option
    for(var name in options.sections) {
        if ({}.hasOwnProperty.call(options.sections, name)) {
            structure[name] = [];

            //Note the section that requires no demarcation
            if (options.sections[name] === '') {
                _sg.defaultSection = name;
            }
        }
    }

    return structure;
}

/**
 * Search through <meta> tags for current section identifiers
 *
 * @param {Object} $article - article html loaded by cheerio
 * @return {Array} Section Name, Section identifier
 */
function getMetaData($article, articleData, currentIdentifier) {

    $article(tags.section).each(function (i2, elem2) {
        articleData.currentSection = $article(this).text().trim();
        currentIdentifier = options.sections[articleData.currentSection];

        //A @section tag is pointing to a non-existant section
        if(_.isUndefined(currentIdentifier)) {
            console.error(_sg.logPre + _sg.error("Error: '" + articleData.currentSection + "' is not a registered 'section' in your '.styleguide' file."));
            process.exit(1);
        }

    }).remove();

    $article(tags.category).each(function (i2, elem2) {

        if (articleData.category === ''){
            articleData.category = $article(this).text().replace(/^\s+|\s+$/g, '').replace(currentIdentifier, '').trim();
            return false;
        }

        var content = renderer.heading.call(renderer, $article(this).html(), 1.1);
        $article(this).replaceWith($article(content));

    }).remove();

    $article(tags.article).each(function (i2, elem2) {
        //Remove dev identifier and extra spaces
        articleData.heading += $article(this).text().replace(/^\s+|\s+$/g, '').replace(currentIdentifier, '').trim();

    }).remove();

    //Store code examples and markup
    $article(tags.example).each(function (i2, elem2) {
        var categoryCode = $article(this).html().replace(/^\s+|\s+$/g, '');
        articleData.code.push(categoryCode);

        //Run markup through highlight.js
        articleData.markup.push(hl.highlight("html", categoryCode).value);

    }).remove();

    //Grab the filelocation and store it
    $article(tags.file).each(function (i2, elem2) {
        articleData.filelocation = $article(this).text().trim();

    }).remove();

    //Grab priority tag data and convert them to meaningful values
    $article(tags.priority).each(function(i2, elem2) {
        var priority = $article(elem2).text().trim();

        articleData.priority = (_.isNaN(Number(priority))) ? priority : Number(priority);

    }).remove();

    if(articleData.heading === '') {
        articleData.priority = -1000;
    }
}


/**
 * Take HTML and create JSON object to be parsed by Handlebars
 *
 * @param {String} html
 * @returns {Array} json
 */
function convertHTMLtoJSON(html) {
    var sectionObject = createSectionStructure();
    var errorLog = false;
    var idCache = {};
    var currentIdentifier = '';
    var previousArticle;
    var $ = cheerio.load(html);

    masterData.sections = Object.assign(sectionObject);

    sanitize.cheerioWrapAll($); //Add wrapAll method to cheerio

    // Loop each section and turn into javascript object
    $('.sg-article-' + _sg.sgUniqueIdentifier).each(function (i, elem) {
        var $article = cheerio.load($(this).html());

        var articleData = {
            id: '',
            currentSection: null,
            section: {
                name: ''
            },
            category: '',
            heading: '',
            fileLocation: '',
            code: [],
            markup: [],
            comment: '',
            priority: 50
        };

        //Check for category headings
        if ($article(tags.category)[0]) {
            var sectionInfo = findSection($article);
            articleData.currentSection = sectionInfo[0];
            currentIdentifier = sectionInfo[1];

        }
        else if(previousArticle !== 'undefined') {
            //Without a heading, assume it should be concatenated with the previous category
            articleData.id = previousArticle.id;
            articleData.category = previousArticle.category;
            articleData.heading = previousArticle.heading;
            articleData.currentSection = previousArticle.section.name;

        }

        //Search through specific DOM elements for article meta data
        getMetaData($article, articleData, currentIdentifier);

        //Wrap dd/dt inside <dl>s
        $article('.sg-code-meta-type').each(function (i2, elem2) {
            var $dddt = $(this).nextUntil(":not(dd, dt)").addBack();
            //Must filter outside of chain because of a quirk in cheerio
            $dddt.filter('dd, dt').wrapAll('<dl class="sg-code-meta-block"></dl>');

            $article('.sg-code-meta-block').find('br').remove();

        }).remove();

        //Give category an ID
        articleData.id = sanitize.makeUrlSafe(articleData.currentSection + '-' + articleData.category  + '-' + articleData.heading);

        //Save sanitized comment html
        articleData.comment = $article.html().replace(/^\s+|\s+$/g, '');

        //Move category data to master
        saveToMaster(articleData);
    });

    /**
     * Combine repeat categories by checking with the ID cache
     * ID Cache format:
     * {1: ["development", 5]}
     * {ID:[section, category-index]}
     *
     * @param {object} articleData - data parsed by DOM objects
     *
    **/

    function saveToMaster(articleData) {

        var currentSection = articleData.currentSection;

        //Bail out for un-categorized comments
        if (currentSection === null) {
            return;
        }

        //If the section's ID has already been cached,
        // just append its data to the previous object
        if (idCache.hasOwnProperty(articleData.id)) {

            //Grab the index
            var currentIndex = idCache[articleData.id][1];

            //Select the matched section from the masterData
            var selectedSection = masterData.sections[currentSection][currentIndex];

            //Append the new data to the matched section
            selectedSection.comment += articleData.comment;

            if (articleData.markup.length > 0) {
                selectedSection.markup.push(articleData.markup);
                selectedSection.markup = _.flatten(selectedSection.markup);
            }
            if (articleData.code.length > 0) {
                selectedSection.code.push(articleData.code);
                selectedSection.code = _.flatten(selectedSection.code);
            }

            return;
        }

        if (masterData.sections[currentSection]) {

            var catIndex = masterData.sections[currentSection].length;

            //Cache the ID and its index within its section
            idCache[articleData.id] = [currentSection, catIndex];
            articleData.section[currentSection] = true;

            articleData.section.name = articleData.currentSection;

            //Remove unnecessary data from final JSON
            delete articleData.currentSection;

            //Append new section to master data
            sanitize.objectPush(masterData.sections[currentSection], articleData);

            previousArticle = articleData;

        }
    }

    masterData = structureData(masterData);

    //Save JSON to file
    if (options.jsonOutput) {
        fs.outputFile(options.jsonOutput, JSON.stringify(masterData, null, '  '), function(err) {
            if(err){
                console.error(_sg.logPre + 'Error: Cannot write ' + options.jsonOutput);
                console.error(err);
            }
            else {
                listFiles(options.jsonOutput, true);
            }
        });

    }

    module.exports.data = masterData;

    return masterData;
}

function structureData(data) {
    /*
     * Sort section data
     */

    if (options.sortCategories){
        //Sort Sections
        Object.keys(data.sections).forEach(function(category){
            data.sections[category] = sorting(data.sections[category]);
        });
    }

    function formatData(sectionName, isMenu) {
        var menuObj = [{}];
        var sectionObj = [{}];
        var menuArr = [];
        var sectionArr = [];
        var sectionHeading;

        data.sections[sectionName].forEach(function(section) {

            //New categories: Create a new array to push objects into
            if (_.has(menuObj[0], section.category) === false) {
                menuObj[0][section.category] = [];
                sectionObj[0][section.category] = [];
            }

            menuObj[0][section.category].push({
                id: section.id,
                name: (section.heading) ? section.heading : section.category
            });

            sectionObj[0][section.category].push(section);
        });

        Object.keys(menuObj[0]).forEach(function(key) {
            menuArr.push({
                category: key,
                id: menuObj[0][key][0].id,
                headings: menuObj[0][key]
            });

            sectionArr.push({
                category: key,
                id: menuObj[0][key][0].id,
                articles: sectionObj[0][key]
            });
        });

        //Wasteful but simple
        return isMenu ? menuArr : sectionArr;
    }

    //Create menu and section JSON
    Object.keys(options.sections).forEach(function(section){
        data.menus[section] = formatData(section, true);
        data.sections[section] = formatData(section, false);
    });

    return data;
}

/**
 * Based on the fileExtension, return a regular expression based on the user-defined sgComment
 *
 * @param {String} fileExtension
 * @returns {RegExp} pattern for either /* or <SG>
 *
 */

function patternType(fileExtension) {
    var sgComment = _.escapeRegExp(options.sgComment);

    if (["md", "markdown", "mdown"].indexOf(fileExtension) !== -1) {
        // Use <SG>...</SG> for markdown files
        return new RegExp('\\<' + sgComment + '>([\\s\\S]*?)\\<\\/' + sgComment + '\\>', 'gi');
    }
    // Use /*SG ... */ for everything else
    return new RegExp('/\\* ?' + sgComment + '([\\s\\S]*?)\\*/', 'gi');
}


/**
 * Read valid files (default: scss/css), get the Styleguide comments and put into an array
 *
 * @param {string} root
 * @param {String} fileExtension
 * @param {Object} fileStats
 * @param {Array} fileContents
 *
 */
function readSGFile(fileExtension, root, fileStats, fileContents) {

    fs.readFile(path.join(root, fileStats.name), 'utf8', function (err, content) {
        var regEsp,
            filePath = './' + path.join(root, _sg.info(fileStats.name)),
            pattern = patternType(fileExtension);

        listFiles(filePath);

        if (err) {
            console.error(_sg.logPre + _sg.error('File Error:') + err);
            process.exit(1);
        }

        while ((regEsp = pattern.exec(content)) !== null) {
            //If reading anything other than css, create a file-location reference we'll use later
            var fileLocation = (fileExtension !== "css") ? '<'+tags.file+'>'+filePath+'</'+tags.file+'>': '';
            //Convert markdown to html
            fileContents.push(markdown(regEsp[1]) + fileLocation);
        }
    });
}

/**
 * Walk the file tree, and return templated html
 *
 * @param {Object} walker
 * @returns {Promise<String>} the file contents wrapped in divs
 *
 */
function walkFiles(walker) {
    var fileContents = [];

    walker.on("file", function (root, fileStats, next) {
        var fileExtension = fileStats.name.substr((~-fileStats.name.lastIndexOf(".") >>> 0) + 2).toLowerCase();

        if (options.fileExtensions[fileExtension]) {
            readSGFile(fileExtension, root, fileStats, fileContents);
            next();
        }
        else {
            next();
        }
    });

    //Send back file contents once walker has reached its end
    return new Promise(
        function(resolve, reject) {
            walker.on("errors", function (root, nodeStatsArray, next) {
                console.error(_sg.logPre + _sg.error('Error'));
                console.dir(nodeStatsArray);
                process.exit(1);
            });

            //Wrap all comments starting with SG in a section
            walker.on("end", function () {
                resolve(fileContents.join('</div>\n<div class="sg-article-' + _sg.sgUniqueIdentifier + '">\n'));
            });
        }
    );
}


function init(args) {
    //Instantiate the markdown renderer before we merge our custom options
    renderer = new markdown.Renderer();
    //Add custom markdown rendering formatters
    renderer = formatters.register(renderer, options);

    //Set up stuff based on arguments
    readArgs(args);

    //Read and Merge default options with custom ones
    readConfig();

    //Make sure theme files exist and save their contents globally
    readTheme();

    //Set markdown options and set renderer to the custom one defined here
    options.markedOptions.renderer = renderer;

    markdown.setOptions(options.markedOptions);

    //Walk the file tree
    walkFiles(walk.walk(options.srcFolder, options.walkerOptions))
    .then(function(fileContents){
            var json = convertHTMLtoJSON('<div class="sg-article-' + _sg.sgUniqueIdentifier + '">\n' + fileContents + '</div>');
            var html = template(json, options);
            saveFile(html);
    });
}

/**
 * Initialize automatically if not being imported
 */
if(!module.parent) {
    init(process.argv.slice(2));
}


module.exports.init = function(args) {
    init(args);
};
