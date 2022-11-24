const readline = require('linebyline');
const fs = require('fs');
const ffmpeg = require('ffmpeg');
const youtubedl = require('youtube-dl');
const nodemailer = require('nodemailer');
//google APIs
const {google} = require('googleapis');
const youtube = google.youtube('v3');

const download_dir = __dirname + '/downloads/';
const srt_dir = __dirname + '/srt_files/';
const output_dir = __dirname + '/outputs/';


const EventEmitter = require('events');
class customEventEmitter extends EventEmitter{};
const stateEmitter = new customEventEmitter();

//event codes
const event_error = -1001;
const event_subtitle_downloaded = 1001;
const event_subtitle_converted = 1002;
const event_subtitle_combined = 1003;
const event_subtitle_uploaded = 1004;
const event_subtitle_processed = 1005;

stateEmitter.on(event_error, (msg) => {
    console.error('err-->' + msg);
});

stateEmitter.on(event_subtitle_downloaded, (files, videoid)=>{
    console.log('converting vtt to srt');
    console.log('converting file-->' + files[0]);
    convertVTT2SRT(download_dir, files, 0, srt_dir, videoid);


});

stateEmitter.on(event_subtitle_converted, (index, files, token) =>{
    if(index < files.length){
        console.log('converting file-->' + files[index]);
        convertVTT2SRT(download_dir, files, index, srt_dir, token);
    }else{
        console.log('do final process');
        //all vtt subtitles are converted to srt files
        let file_pri = srt_dir + files[1];
        let file_sec = srt_dir + files[0];

        let filename = token + '.zh_en.srt';
        // let filename = files[0].substring(0, files[0].length - 9) + '.zh_en.srt';
        doFinalProcess(file_pri, file_sec, output_dir + filename,'en', token);
    }
});

stateEmitter.on(event_subtitle_processed, (videoid)=>{
    let file = output_dir + videoid + '.en.srt';
    traverseEnglish(file);
});



//patterns
//start time
const pattern_start_time = /^[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9]/;
//end time
const pattern_end_time = /[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9]$/;
const pattern_timestamp = /^[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9] --> [0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9]/g;
const pattern_num = /\d+/;
const pattern_chinese_symbol = /[，|。|、|？|！|￥|（|）|【|】|？|“|”]/g;
const lang_en = 'en';
const lang_cn = 'cn';

/**
 *
 *
 *
 * Main Code
 *
 *
 *
 */

let auth_key = __dirname + '/auth_key.json';
let YOUTUBE_API_KEY;
let GMAIL_API_KEY;
var blocks_en = [];
var sentences = [];
var sentence_count = 0;
sentences.push('');
let target_video = '';
let retry_download = false;

let ts = new Date();
console.log(ts + ': checker started...');
setInterval(checkPlaylist, 3600000);


/**
 *
 *
 * local functions
 *
 *
 *
 */
function traverseEnglish(srt){
    var linecount = 0;
    var blockcount = 0;
    console.log('traversing english subtitle...\n' + __dirname + '/' + srt);
    var rl_en = readline(srt);
    rl_en.on('line', function(line, lineCount, byteCount) {
        if(linecount == 0 && line != ''){
            // console.log('line index:' + line);
            //create new block
            /**
             * block object
             * timestamp
             * start_time
             * end_time
             * subtitle
             */
            var block = [];
            block.start_time = 0;
            block.end_time = 0;
            block.timestamp = '';
            block.subtitle = '';
            blocks_en.push(block);

            linecount++;
        }else if(linecount == 1){
            // console.log('timestamp:' + line);
            var block = blocks_en[blockcount];
            var start_time = line.match(pattern_start_time)[0];
            var end_time = line.match(pattern_end_time)[0];
            block.start_time = convertTS2TM(start_time);
            block.end_time = convertTS2TM(end_time);
            block.timestamp = line;
            linecount++;
        }else{
            if(line != ''){
                // console.log('subtitle line:'+ line);
                var block = blocks_en[blockcount];
                //remove last whitespace
                var c = line.charAt(line.length - 1);
                if(c == ' ')//remove last space
                    line = line.substring(0, line.length - 1);
                c = line.charAt(0);
                if(c== ' ')//remove first space
                    line = line.substring(1, line.length);
                if(linecount == 3)
                    block.subtitle += ' ' + line;
                else
                    block.subtitle = line;

                let sentence = sentences[sentence_count];

                sentence += ' ' + line;
                sentences[sentence_count] = sentence;
                // console.log('sentence:' + sentence + ' count=' + sentence_count);
                var last = line.charAt(line.length - 1);
                if(last == ']' || last == '.'){
                    sentences.push('');
                    sentence_count++;
                    console.log('sentence:' + sentence + ' count=' + sentence_count);
                }

                linecount++;
                // console.log('block subtitle:' + block.subtitle);
            }else{
                // console.log('new line');
                linecount = 0;
                blockcount++;
            }
        }

    })
        .on('error', function(e) {
            // something went wrong
            console.log(e);
        })
        .on('close', function(e){
            console.log('finished traversing english subtitle');
            blockcount = 0;
            linecount = 0;

            let content = '';
            for(let i=0; i<sentences.length; i++){
                // let b = blocks_en[i];
                // showBlock(b);
                let s = sentences[i];
                console.log(s);
                content += (s + '\n');
            }
            console.log('translating subtitle...');
            translateText(content, 'zh-CN');
        });
}



//convert formatted timestamp to time value in miliseconds
function convertTS2TM(timestamp){
    var raw = timestamp.split(',');
    var time = raw[0].split(':');
    var hour = parseInt(time[0]);
    var minute = parseInt(time[1]);
    var second = parseInt(time[2]);

    var miliseconds = parseInt(raw[1]);

    var total = miliseconds + second * 1000 + minute * 60000 + hour * 3600000;
    // console.log('total:' + total + ' hour='+ hour + ' minute=' + minute + ' second=' + second + ' miliseconds=' + miliseconds);
    return total;
}

//convert plain time value to formatted timestamp
function convertTM2TS(tm){

    var ms = tm%1000;
    var s = parseInt(tm/1000)%60;
    var m = parseInt(tm/60000);
    var h = parseInt(tm/3600000);
    var ms_str,s_str, m_str, h_str;
    if(ms < 10){
        ms_str = '00' + ms;
    }else if(ms >= 10 && ms < 100 ){
        ms_str = '0' + ms;
    }else{
        ms_str = ms;
    }

    if(s < 10){
        s_str = '0' + s;
    }else{
        s_str = s;
    }

    if(m < 10){
        m_str = '0' + m;
    }else{
        m_str = m;
    }

    if(h < 10){
        h_str = '0' + h;
    }else{
        h_str = h;
    }

    var result = h_str + ':' + m_str + ':' + s_str + ',' + ms_str;
    return result;
}

function showBlock(block){
    console.log('timestamp:' + block.timestamp + ' start_time=' + block.start_time + ' end_time=' + block.end_time + ' subtitle=' + block.subtitle);
}


function sendMail(receiver, subject, content, attatchment){


    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'ydroidt7@gmail.com',
            pass: GMAIL_API_KEY
        }
    });

    const mailOptions = {
        from: 'ydroidt7@gmail.com',
        to: receiver,
        subject: subject,
        text: content,
        attatchment:{
            path: attatchment
        }
    };

    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
            // do something useful
        }
    });
}


//parse response data from youtube
function parseYoutubeData(raw){
    // console.log('raw-->' + JSON.stringify(raw));
    var kind = raw.kind;
    console.log('kind:' + kind);
    var etag = raw.etag;
    console.log('etag:' + etag);
    var pageInfo = raw.pageInfo;
    console.log('pageInfo: totalResults=' + pageInfo.totalResults + "  resultsPerPage=" + pageInfo.resultsPerPage);
    var items = raw.items;
    let item = items[0];
    let video = {};
    video.id = item.snippet.resourceId.videoId;
    video.title = item.snippet.title;
    video.description = item.snippet.description;
    video.position = item.snippet.position;
    video.publish_date = item.snippet.publishedAt;
    video.privacyStatus = item.status.privacyStatus;

    console.log('video.id=' + video.id + '  video.title=' + video.title + ' video.position=' + video.position + ' video.publish_date=' + video.publish_date + ' video.privacyStatus=' + video.privacyStatus);

    return video;

}

function checkPlaylist(){
    let ts = new Date();
    console.log(ts + ':checking playlist');

    fs.readFile(auth_key, function(err, data){
        if(err) {
            console.log(err);
        }
        let raw = JSON.parse(data);
        YOUTUBE_API_KEY = raw.youtube_apikey;
        GMAIL_API_KEY = raw.gmail_apikey;
        loadYoutube('PLOU2XLYxmsII8REpkzsy1bJHj6G1WEVA1');
    });
}

function loadYoutube(playlistID){
    youtube.playlistItems.list({
            key:YOUTUBE_API_KEY,
            playlistId: playlistID,
            part: 'snippet,contentDetails,status',
            maxResults: 3},
        function(err, res){
            if(err){
                console.log(err);
            }else{
                //start parsing youtube data
                let video = parseYoutubeData(res.data, playlistID);
                let d = new Date();
                let pd = new Date(video.publish_date)
                let diff = d - pd;
                let gap = diff/3600000.0;
                if(gap <= 1.5 || retry_download){
                    let target = video.id;
                    if(retry_download){
                        target = target_video;
                    }
                    retrieveYoutubeCCCaption(target, 'en');
                }else{
                    let ts = new Date();
                    console.error(ts + ': time span is ' + gap + '\nno new episode found.');
                }

            }//end of playlist list method

        });
}


// Imports the Google Cloud client library
const {Translate} = require('@google-cloud/translate').v2;

const projectID = 'glocalizationprojects';
// Creates a client
const translate = new Translate({projectID});

/**
 * TODO(developer): Uncomment the following lines before running the sample.
 */
// const text = 'The text to translate, e.g. Hello, world!';
// const target = 'The target language, e.g. ru';

async function translateText(text, lang) {
    // Translates the text into the target language. "text" can be a string for
    // translating a single piece of text, or an array of strings for translating
    // multiple texts.
    let [translations] = await translate.translate(text, lang);
    translations = Array.isArray(translations) ? translations : [translations];
    // console.log('Translations:');
    let content = text + '\n';
    translations.forEach((translation, i) => {
        // console.log(translation);
        content += (translation + '\n');
    });

    let file = output_dir + videoid + '.en.srt';
    sendMail('yuan@gdsub.com, yuant614@gmail.com', 'found new episode of TLDR', content, file);

}

/**
 * download cc caption from youtube
 * @param videoid
 * @param callback
 */
function retrieveYoutubeCCCaption(videoid, lang){
    let url = 'https://www.youtube.com/watch?v=' + videoid;
    let option_lang = lang;
    if(lang == 'en'){
        lang = 'en,en-US';
    }else if(lang == 'cn'){
        lang = 'zh-Hans,zh-CN';
    }
    const options = {
        // Write automatic subtitle file (youtube only)
        auto: false,
        // Downloads all the available subtitles.
        all: false,
        // Subtitle format. YouTube generated subtitles
        // are available ttml or vtt.
        format: 'vtt',
        // Languages of subtitles to download, separated by commas.
        lang: lang,
        // The directory to save the downloaded files in.
        cwd: download_dir,
    }

    youtubedl.getSubs(url, options, function(err, files) {
        if (err) console.error(err.toString());
        if(files.length > 0){
            let f = files[0];
            console.log('rename downloaded subtitle file -->' + f);
            let newName = f.replace(/\(|\)|\'|\s+|-/g, '');
            console.log('new file name -->' + newName);
            fs.renameSync(download_dir + f, download_dir + newName);
            let output_file = download_dir + newName + '.2.srt';
            fs.access(output_file, (err) => {
                if (!err) {
                    console.log('output file exists, remove it');
                    fs.unlinkSync(output_file);
                }
                let process = new ffmpeg(download_dir + newName);
                process.then((srtFile) => {
                    console.log('file is ready to be processed, file-->' + download_dir + newName);
                    console.log('candidate -->' + srtFile);
                    srtFile.save(download_dir + newName + '.2.srt', (err, output_file) => {
                        console.log('srt file saved. output-->' + output_file);
                        if(err){
                            console.error(err.toString());

                        }else{
                            let target = download_dir + newName + '.2.srt';

                            traverse(target, option_lang, videoid, (t) => {
                                let blocks = t.blocks;
                                let output_file = output_dir + videoid + '.' + option_lang + '.srt';
                                generateMonolingualSubtitle(blocks, output_file, videoid);
                            });
                        }
                    });
                });

            });//end of fs.access

        }else{
            console.log('unable to download target file from remote server. retry later...');
            target_video = videoid;
            retry_download = true;
        }

    });
}



let traverse = function(file, lang, videoid, callback){

    console.log('traversing subtitle -->' + file);
    var task = {};

    // task.sentence_block = [];
    task.blocks = [];
    task.sentence_index = 0;

    // var sentence_block = task.sentence_block;
    var blocks = task.blocks;
    let lineNum = 1;
    var linecount = 0;
    var blockcount = 0;

    var sentence_index = 0;
    var rl_sub = readline(file);
    var sentence = '';
    var sub_index_arr = [];
    rl_sub.on('line', function(line, lc, byteCount) {
        //debug
        console.log('\n*************debug*************\n');
        console.log('line:' + line + ' linecount=' + linecount + ' blockcount=' + blockcount);
        console.log('\n*************debug*************\n');

        if(isInfoLine(line)){
            console.log('this string is info line');
            //get last block
            let block = blocks[len - 1];
            block.subtitle = line;
        }else{
            if(linecount == 0){//in srt files, the first line is always the number line
                if(line != ''){
                    //create new block
                    /**
                     * *block object*
                     *
                     * line number
                     * timestamp
                     * start_time
                     * end_time
                     * subtitle
                     * sentence index
                     * issubtitle
                     *
                     */
                    console.log('create new block');
                    var block = {};
                    block.line_number = lineNum++;//line;
                    block.start_time = 0;
                    block.end_time = 0;
                    block.timestamp = '';
                    block.subtitle = '';
                    block.sentence = sentence_index;
                    block.issubtitle = true;
                    blocks.push(block);
                    linecount++;

                }else{
                    console.log('empty line, ignore it');
                }

            }else if(linecount == 1){//the second line is always the timestamp line
                console.log('timestamp line');
                let len = blocks.length;
                //get last block
                let block = blocks[len - 1];
                var start_time = line.match(pattern_start_time)[0];
                var end_time = line.match(pattern_end_time)[0];
                block.start_time = convertTS2TM(start_time);
                block.end_time = convertTS2TM(end_time);
                block.timestamp = line;
                linecount++;
            }else if(linecount == 2 && line == ''){
                //lost subtitle text, skip this block
                console.log('lost subtitle text, set default value to block and skip');
                let len = blocks.length;
                //get last block
                let block = blocks[len - 1];
                block.subtitle = '[[lost text]]';
                linecount = 0;
                blockcount = blocks.length + 1;
            }else{//the third line is always the subtitle line. in some cases,
                // the actual subtitle might contain two lines or more.
                console.log('last code block');
                if(line != ''){
                    //console.log('subtitle line:'+ line);
                    // console.log('checking last character:' + line.substring(line.length - 1));
                    let len = blocks.length;
                    //get last block
                    let block = blocks[len - 1];
                    if(line.substring(line.length - 1) != '♪' && line.substring(line.length - 1) != ')' && line.substring(line.length - 1) != ']'){
                        sentence += line + ' ';
                        if(linecount == 2){
                            //push line number to subtitle index array
                            //console.log('push line number to tmp array, line number=' + block.line_number);
                            sub_index_arr.push(block.line_number);
                        }
                    }else{
                        block.issubtitle = false;
                        block.sentence = -1;
                    }
                    //remove last whitespace
                    var c = line.charAt(line.length - 1);
                    if(c == ' ')//remove last space
                        line = line.substring(0, line.length - 1);
                    c = line.charAt(0);
                    if(c== ' ')//remove first space
                        line = line.substring(1, line.length);
                    if(linecount == 3){//combine two lines into one
                        if(lang == lang_en){
                            block.subtitle += ' ' + line;
                        }else if(lang == lang_cn){
                            block.subtitle += '[[#TODO]]' + line;
                        }else{
                            block.subtitle += ' ' + line;
                        }
                    }else{
                        block.subtitle = line;
                    }

                    linecount++;
                }else{
                    console.log('reset linecount, and increase blockcount');
                    linecount = 0;
                    blockcount = blocks.length + 1;
                }
            }
        }
    })
        .on('error', function(e) {
            // something went wrong
            console.log(e);
        })
        .on('close', function(e){
            if(e){
                throw e;
            }
            blockcount = 0;
            linecount = 0;
            if(typeof(callback) != 'undefined' && callback != null){
                callback(task);
            }
        });
}

function generateMonolingualSubtitle(blocks, targetFile, videoid) {
    console.log('start generating final subtitle file...' + targetFile);
    fs.access(targetFile, (err) => {
        if (!err) {
            console.log('file exists, remove it');
            fs.unlinkSync(targetFile);
        }
        console.log('traversing subtitle blocks');
        for (let i = 0; i < blocks.length; i++) {
            let b = blocks[i];
            let content = convertBlockToMonoSubtitle(b);
            fs.appendFileSync(targetFile, content);
        }
        stateEmitter.emit(event_subtitle_processed, videoid);
    });
}

let convertBlockToMonoSubtitle = (block) => {
    let str = block.line_number + '\n'
        + block.timestamp + '\n'
        + block.subtitle + '\n'
        + '\n';
    return str;

};

//check string if it is info line
function isInfoLine(str){
    let firstChar = str.substring(0, 1);
    let lastChar = str.substring(str.length - 1, str.length);
    console.log('firstChar=' + firstChar + ' lastChar=' + lastChar);
    if(firstChar == '[' && lastChar == ']'){
        return true;
    }else{
        return false;
    }
    return false;
}

/***
 *
 * convert vtt to srt
 *
 */
function convertVTT2SRT(base_dir, files, index, output_dir, videoid){

    let targetFile = base_dir + files[index];
    let file_str = files[index];
    let srtName = file_str.substring(0, file_str.length - 4) + '.srt';
    fs.access(output_dir + srtName, (err) => {
        if (!err) {
            console.log('file exists, remove it');
            fs.unlinkSync(output_dir + srtName);
        }
        let process = new ffmpeg(targetFile);
        process.then((f) => {

            console.log('start converting -->' + output_dir + srtName);
            f.save(output_dir + srtName, (err) => {
                console.log('converted file -->' + output_dir + srtName);

                if(err){
                    throw err;
                }
                // let i = file.lastIndexOf('/');
                // let file_name = file.substring(i + 1, file.length);
                files[index] = srtName;
                index++;
                stateEmitter.emit(event_subtitle_converted, res, index, files, videoid);

            } );
        });
    });

}

function checkSubtitleTimestamp(blocks_pri, blocks_sec, token, callback){
    console.log('start comparing... primary subtitle total blocks-->' + blocks_pri.length + ' secondary subtitle total blocks-->' + blocks_sec.length);
    let len = blocks_pri.length;

    let newBlocks = [];
    let j = 0;
    for(let i=0; i<len;){
        // console.log('i-->' + i + ' j-->' + j);download_combined
        let b_pri = blocks_pri[i];
        if(!b_pri.issubtitle){
            //this line is not subtitle, add an empty line to chinese block array
            var block = {};
            block.line_number = b_pri.line_number;
            block.start_time = b_pri.start_time;
            block.end_time = b_pri.end_time;
            block.timestamp = b_pri.timestamp;
            block.subtitle = null;
            block.sentence = null;
            block.issubtitle = true;
            newBlocks.push(block);
            i++;

            continue;
        }

        if(j >= blocks_sec.length){
            // console.log('reached end of chinese blocks, add empty block to it');
            block = {};
            block.line_number = b_pri.line_number;
            block.start_time = b_pri.start_time;
            block.end_time = b_pri.end_time;
            block.timestamp = b_pri.timestamp;
            block.subtitle = null;
            block.sentence = null;
            block.issubtitle = true;
            newBlocks.push(block);
            i++;
        }else{
            let b_sec = blocks_sec[j];
            // console.log('comparing block en-->' + showSubtitleBlock(b_en) + '\n' + 'cn-->' + showSubtitleBlock(b_cn));
            if(b_pri.end_time <= b_sec.start_time){
                //english subtitle is ahead of chinese subtitle, add empty block to blocks_cn

                var block = {};
                block.line_number = b_pri.line_number;
                block.start_time = b_pri.start_time;
                block.end_time = b_pri.end_time;
                block.timestamp = b_pri.timestamp;
                block.subtitle = null;
                block.sentence = null;
                block.issubtitle = true;
                newBlocks.push(block);
                i++;
            }else if(b_sec.end_time <= b_pri.start_time){
                j++;
            }else if((b_pri.start_time <= b_sec.start_time && b_pri.end_time > b_sec.start_time) || (b_pri.start_time >= b_sec.start_time && b_pri.start_time < b_sec.end_time)){
                b_sec.start_time = b_pri.start_time;
                b_sec.end_time = b_pri.end_time;
                b_sec.timestamp = b_pri.timestamp;
                newBlocks.push(b_sec);
                i++;
                j++;
            }
        }
    }
    if(typeof(callback) != 'undefined' && callback != null){
        callback(true, newBlocks);
    }
}

let generateSubtitle = function(b_pri, b_sec, lang_pri='en', targetFile){

    console.log('start generating final subtitle file...' + targetFile);

    fs.access(targetFile, (err) => {
        if(!err){
            console.log('file exists, remove it');
            fs.unlinkSync(targetFile);
        }

        console.log('traversing subtitle blocks');

        let j = 0;
        let omitted_blocks = [];
        for(let i=0; i<b_pri.length; i++){
            let block_pri = b_pri[i];
            let block_sec = b_sec[j];

            if(block_pri.start_time == block_sec.start_time && block_sec.subtitle != null){
                let content = convertBlockToSubtitle(block_pri, block_sec, lang_pri);
                fs.appendFileSync(targetFile, content);
                j++;
            }else{
                let str = block_pri.line_number + '\n'
                    + block_pri.timestamp + '\n'
                    + block_pri.subtitle + '\n'
                    + '\n';
                fs.appendFileSync(targetFile, str);
                omitted_blocks.push(block_sec);
                j++;
            }
        }
    });
}

let convertBlockToSubtitle = (block_pri, block_sec, lang_pri = 'en') => {
    let str = block_pri.line_number + '\n'
        + block_pri.timestamp + '\n';
    if(lang_pri == 'en'){

        str += block_sec.subtitle + '\n'
            + block_pri.subtitle + '\n'
            + '\n';
    }else{
        str += block_pri.subtitle + '\n'
            + block_sec.subtitle + '\n'
            + '\n';
    }

    return str;

};


function doFinalProcess(file_pri, file_sec, output, lang_pri ,token){
    let blocks_pri;
    let blocks_sec;
    let lang_sec = 'cn';

    if(lang_pri == 'cn'){
        lang_sec = 'en';
    }

    traverse(file_pri, lang_pri, token, (t) => {
        blocks_pri = t.blocks;
        traverse(file_sec, lang_sec, token, (t) => {
            blocks_sec = t.blocks;
            checkSubtitleTimestamp(blocks_pri, blocks_sec, token, (r, blocks) =>{
                if(r){
                    console.log('timestamps are identical.');
                    generateSubtitle(blocks_pri, blocks, lang_pri,output);
                }

            });

        });
    });
}


/**
 *
 *
 *
 *
 *
 * ************************************   sample data  **************************************************************
 *
 *
 *
 *
 */

/**
 *
 *
 *
 *
 * {"config":
 * 	{"url":"https://youtube.googleapis.com/youtube/v3/playlistItems?key=&playlistId=PLOU2XLYxmsII8REpkzsy1bJHj6G1WEVA1&part=snippet%2CcontentDetails%2Cstatus&maxResults=2",
 * 	"method":"GET",
 * 	"userAgentDirectives":
 * 		[{"product":"google-api-nodejs-client","version":"6.0.3","comment":"gzip"}],
 * 	"headers":
 * 		{"x-goog-api-client":"gdcl/6.0.3 gl-node/16.17.0 auth/8.6.0","Accept-Encoding":"gzip",
 * 		"User-Agent":"google-api-nodejs-client/6.0.3 (gzip)","Accept":"application/json"},
 * 	"params":{"key":"",
 * 		"playlistId":"PLOU2XLYxmsII8REpkzsy1bJHj6G1WEVA1",
 * 		"part":"snippet,contentDetails,status","maxResults":2},
 * 		"retry":true,
 * 		"responseType":"json"},
 * 	"data":{"kind":"youtube#playlistItemListResponse","etag":"zbgwZE2tizhXvtEloWgPu_OafDg","nextPageToken":"EAAaBlBUOkNBSQ",
 * 			"items":
 * 				[
 * 					{"kind":"youtube#playlistItem","etag":"FcJ-BBhBH2-FPUhj_-AF_xiyoLY",
 * 					"id":"UExPVTJYTFl4bXNJSThSRXBrenN5MWJKSGo2RzFXRVZBMS5BOUNEMEI0OUY1OEEwQzdC",
 * 					"snippet":{"publishedAt":"2022-10-13T19:01:13Z","channelId":"UC_x5XG1OV2P6uZZ5FSM9Ttw",
 * 					"title":"Google Cloud Next 2022, Dart partnership with GitHub, and more dev news!",
 * 					"description":"TL;DR 315 | The Google Developer News Show\n\n
 * 									0:00 - Introduction\n
 * 									0:10 - Partnering with GitHub on supply
 * 								       	chain security for Dart packages → https://goo.gle/3EKj2Fs \n
 * 								    0:32 - Google Cloud Next 2022 → https://goo.gle/3EKiXSa \n
 * 								    0:46 - CircularNet: Reducing waste with Machine Learning → https://goo.gle/3CUjr7g \n
 * 								    1:20 - Kick Start Round G → https://goo.gle/3ET648P \n
 * 								    1:51 -  Don’t forget to like, comment, and subscribe!\n \n
 * 								            Here to bring you the latest developer news from across Google is Rody from Developer Relations.
 * 								            Tune in every week for a new episode, and let us know what you think of the latest announcements
 * 								            in the comments below.\n\nFollow Google Developers on Instagram → https://goo.gle/googledevs             \n\n
 * 								            Watch more #DevShow → https://goo.gle/GDevShow               \n
 * 								            Subscribe to Google Developers → https://goo.gle/developers \n\n
 * 								            #Google #Developers",
 * 			            "thumbnails":{"default":{"url":"https://i.ytimg.com/vi/Ay5O5H9MAlI/default.jpg","width":120,"height":90},
 * 			            "medium":{"url":"https://i.ytimg.com/vi/Ay5O5H9MAlI/mqdefault.jpg","width":320,"height":180},
 * 			            "high":{"url":"https://i.ytimg.com/vi/Ay5O5H9MAlI/hqdefault.jpg","width":480,"height":360},
 * 			            "standard":{"url":"https://i.ytimg.com/vi/Ay5O5H9MAlI/sddefault.jpg","width":640,"height":480},
 * 			            "maxres":{"url":"https://i.ytimg.com/vi/Ay5O5H9MAlI/maxresdefault.jpg","width":1280,"height":720}
 * 			          },
 * 			          "channelTitle":"Google Developers",
 * 			          "playlistId":"PLOU2XLYxmsII8REpkzsy1bJHj6G1WEVA1",
 * 			          "position":0,
 * 			          "resourceId":{"kind":"youtube#video","videoId":"Ay5O5H9MAlI"},
 * 			          "videoOwnerChannelTitle":"Google Developers",
 * 			          "videoOwnerChannelId":"UC_x5XG1OV2P6uZZ5FSM9Ttw"},
 * 			          "contentDetails":{"videoId":"Ay5O5H9MAlI","videoPublishedAt":"2022-10-13T21:00:05Z"},
 * 			          "status":{"privacyStatus":"public"}
 *     }]}}
 *
 *
 *
 *
 *
 *
 */















