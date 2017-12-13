'use strict'
const consistency = require('./consistency');
const exec = require('./shell').execshell;
const setting = require('./setting');
const logobject = require('./log');
const stdio = require('stdio');
const path = require('path');

const idLength = 24;
const IdentifierRE = /^[A-Za-z0-9]{24}/;
const NameRE = /\/\* [^\*\/]* \*\//;

const handleTempDir = setting.processTempDir;
const PBXSecionNames = setting.PBXSecionNames;

String.prototype.trimall = function(){
    return this.replace(/\s/g,"");
}
const version = '0.0.2';
const lastModify = '2017/9/19';
let opts = {};

async function start() {
    let entrancePath = await prepareWork();
    if (!entrancePath || entrancePath.length < 1){
        console.log('error : 未找到入口文件');
        return;
    }
    console.log('start');
    let PBXFilePath = await getPBXFilePath(entrancePath);
    await creatSubFile(PBXFilePath);
    let allTargetsID = await targets();
    let targetInfo = await targetsStructure(allTargetsID);
    let allSourceMap = await getALLTargetSource(targetInfo,PBXFilePath);
    let buildRefMap = await processBuildFile();
    let fileRefMap = await processFileRef();
    let groupRefMap = await processGroupRef();
    let variantMap = await processVariantGroupRef();

    let filesSet = new Set();
    if(!opts.checkfile || opts.checkfile.toUpperCase() !== "N"){
        filesSet = await fileList(entrancePath);
    }    
    await checkTargets(targetInfo,allSourceMap,buildRefMap,fileRefMap,groupRefMap,variantMap,filesSet);
    console.log("target资源检查完毕...");

    // 检查DSYM是否存在
    if(!opts.dsym || opts.dsym.toUpperCase() !== 'N'){
        let configList = await getConfigurationList();
        await checkDSYM(configList);
        console.log("DSYM检查完毕...");
    }
    
     // 下面是根据项目定制的功能：检查不同target中的文件是否一样 
    await consistency.checkTargetConsistency(targetInfo,allSourceMap);
    if (!opts.verbose) {
        await logobject.deleteIneffectiveLog();
    };
    let str = await logobject.content();
    if(str) {
        console.log(str);
    }
    console.log("对应target资源一致性检查完毕...");
    console.log('finish');    
}

async function prepareWork() {
    opts = stdio.getopt({
        'version' : {key: 'V',description:'当前版本'},
        'verbose' : {key: 'v',description:'输出所有日志'},
        'dsym' : {key: 'd', args: 1, description: '是否检查dsym，默认检查。如果不检查请用‘n/N’'},
        'checkfile' : {key: 'c',args: 1, description: '是否检查本地文件，默认检查。如果不检查请用‘n/N’'},
    });
    if(opts.version){
        console.log(`Version : ${version}, LastModify : ${lastModify}`);
        process.exit();
    }
    let entrancePath = "";
    if(opts.args && opts.args.length > 0){
        entrancePath = opts.args[0];
        console.log("文件路径为:",entrancePath);
    }
    let shStr = `rm -rf ${handleTempDir}`;
    await exec(shStr);
    shStr = `mkdir ${handleTempDir}`;
    await exec(shStr);
    logobject.clear();
    return entrancePath;
}

async function getPBXFilePath(entrancePath){
    let finsFileSh = `find ${entrancePath} -name project.pbxproj | sed '/Pods/d'`;
    let PBXFilePath = await exec(finsFileSh);
    PBXFilePath = PBXFilePath.trim();
    if(!PBXFilePath || PBXFilePath.length < 1){
        console.log("找不到project.pbxproj文件");
        process.exit();
    }
    return PBXFilePath;
}

async function creatSubFile(pbxFilePath){
    for(let i=0;i<PBXSecionNames.length;i++){
        let name = PBXSecionNames[i];
        let regularStr = `/Begin ${name} section/,/End ${name} section/p`;
        let desFilePath = handleTempDir + '/' + name;
        let shStr = `sed -n '${regularStr}' ${pbxFilePath} > ${desFilePath}`;
        await exec(shStr); // exec执行出问题会直接退出程序
    }
}

/**
 * 从PBXProject找到所有targets的identifier
 * @return {Map} {targetsName : identifier : ,...}
 *         item举例 : EQHexin : 1D6058900D05DD3D006BFB54
 */
async function targets(){
    let regularStr = '/targets = (/,/);/p';
    let PBXProjectFilePath = handleTempDir + '/PBXProject';
    let shStr = `sed -n '${regularStr}' ${PBXProjectFilePath}`;
    let resstr = await exec(shStr);
    let tempmap = await analyseStr(resstr);
    if(!tempmap) {
        console.log('不能从PBXProject找到targets结构');
        process.exit();
    }
    return tempmap;
}

/**
 * 获得所有target的每个section的identifier
 * @param  {Map} targetsIds  所有target的identifier {EQHexin : 1D6058900D05DD3D006BFB54, ...}
 * @return {Object} {targetname : Map}, targetname是每个target的name，Map是每个target对应的资源文件
 *         item举例 : {EQHexin : {Resources : 1D60588D0D05DD3D006BFB54,...},...} 
 */
async function targetsStructure(targetsIds){
    // 处理每个target
    let targetInfoTemp = {};
    for(let item of targetsIds){
        let name = item[0];
        let identifier = item[1];
        if(targetInfoTemp[name]){
            continue; 
         }
         let infoMap = await getTargetInfo(identifier);
         targetInfoTemp[name] = infoMap;
    }
    return targetInfoTemp;
}

/**
 * 从PBXNativeTarget文件中读取出Resources,Sources,Frameworks,Copy Files这四项对应的identifier
 * @param {string} identifier target的identifier 举例：1D6058900D05DD3D006BFB54(EQHexin)
 * @return {Map} {sectionname : identifier}
 *         举例: Resources : 1D60588D0D05DD3D006BFB54 
 */ 
async function getTargetInfo(identifier){
    if(!identifier || identifier.length !== idLength){
        console.log("PBXProject中存在错误: ",identifier);
        return;
    }
    let regularStr = `/${identifier}/,/};/p`
    let PBXNativeTargetPath = handleTempDir + '/PBXNativeTarget';
    let tempFilePath = handleTempDir + '/tempTarget';
    let shStr = `sed -n '${regularStr}' ${PBXNativeTargetPath} | sed -n '/buildPhases/,/);/p'`;
    let resstr = await exec(shStr);
    let lines = resstr.split('\n');
    let length = lines.length;
    let infoMap = new Map();
    for(let i=0;i<length;i++){
        let tempstr = lines[i].trim();
        let identifer = matchStr(tempstr,IdentifierRE);
        let sectionname = matchStr(tempstr,NameRE).slice(3,-3).trimall();
        if(identifer.length>0 && sectionname.length>0){
            infoMap.set(sectionname,identifer);
        }
    }
    return infoMap;
}

/**
 * 解析如下格式字符串
 * 3DB8BF2C1AE51FDE00DD74F8 \/* 6013.xib in Resources *\/,\n 3DB8BF2D1AE51FDE00DD74F8 \/* 6000.xib in Resources *\/
 * @param {sting} str 用于解析的字符串
 * @param {sting} start 开始解析flag
 * @param {sting} end   结束解析的flag
 * @return {Map} {filename : identifier}
 *         item举例: 6013.xib in Resources : 3DB8BF2C1AE51FDE00DD74F8
 */
function analyseStr(str){
    if(!str || str.length < 1) {
        return;
    }
    let lines = str.split('\n');
    let tempmap = new Map();

    for(let i=0;i<lines.length;i++){
        let tempstr = lines[i];
        tempstr = tempstr.trim();
        let nametemp = matchStr(tempstr,NameRE);
        let idtemp = matchStr(tempstr,IdentifierRE);
        if(nametemp.length < 1 && idtemp.length < 1){
            continue;
        }
        if((idtemp.length === idLength && nametemp.length < 1) || 
            (idtemp.length !== idLength && nametemp.length > 1)){
            console.log(`${tempstr} 存在错误`);
            continue;
        }
        nametemp = nametemp.slice(3,-3);
        if (tempmap.has(nametemp)) {
            console.log("以下资源中只能存在一个，请检查PBXBuildFile，PBXFileReferences是否存在该identifier");
            console.log(`资源1 identifier: ${idtemp}, name: ${nametemp}`);
            console.log(`资源2 identifier: ${tempmap.get(nametemp)}, name: ${nametemp} \n`);
        }
        tempmap.set(nametemp,idtemp);
    }
    return tempmap;
}

/**
 * 从PBXBuildFile中读出所有的buildidentifier，并剔除掉重复的identifier
 * @return {Map} {identifer : [fileReference,fielname],...}
 *         item举例: 020582A41D059B99004C1FC1 : [020582A31D059B98004C1FC1, TouchID_Tip.png]
 */
async function processBuildFile(){
    let PBXBuildFilePath = handleTempDir + '/PBXBuildFile';
    let shStr = `cat ${PBXBuildFilePath}`;
    let resstr = await exec(shStr);
    let allLines = resstr.split('\n');
    const fileInfoRE = /fileRef = .*/;
    let buildRefMap = new Map();
    for(let i=0;i<allLines.length;i++){
        let lineStr = allLines[i];
        if(lineStr.length < 33){
            continue;
        }
        lineStr = lineStr.trim();
        let identifer = matchStr(lineStr,IdentifierRE);
        let fileinfo = matchStr(lineStr,fileInfoRE);
        let fileReference = fileinfo.slice(10,34);
        let fileName = fileinfo.slice(38,-7);
        if(identifer.length < idLength || fileReference.length<idLength || fileName.length < 1){
            console.log('PBXBuildFile中存在错误 : ',lineStr);
            continue;
        }
        if(buildRefMap.has(identifer)) {
            console.log('PBXBuildFile中存在重复 : ',identifer);
            continue;
        }
        buildRefMap.set(identifer,[fileReference,fileName]);
    }
    allLines = [];
    return buildRefMap;
}

/**
 * 从PBXFileReference中读出所有的FileReference，并剔除掉重复的FileReference
 *  @return {Map} {fileReference : fielname,...}
 *          item举例: 020582A31D059B98004C1FC1 : TouchID_Tip.png
 */
async function processFileRef(){
    let PBXFileRefPath = handleTempDir + '/PBXFileReference';
    let shStr = `cat ${PBXFileRefPath}`;
    let resstr = await exec(shStr); 
    let allLines = resstr.split('\n');
    let fileRefMap = new Map();
    const FileNameRE = /path = [^*;]*;/;
    for(let i=0;i<allLines.length;i++){
        let lineStr = allLines[i].trim();
        if(lineStr.length < 37){
            continue;
        }
        let reference  = matchStr(lineStr,IdentifierRE);
        let fileName = matchStr(lineStr,FileNameRE).slice(7,-1);
        fileName = fileName.replace(/^"/,"");
        fileName = fileName.replace(/"$/,"");
        if(reference.length < idLength || fileName.length < 1){
            console.log("PBXFileReference中错误: ", lineStr);
            continue;
        }
        if(fileRefMap.has(reference)){
            console.log("PBXFileReference中存在重复: ",reference);
            continue;
        }
        fileRefMap.set(reference,fileName);
    }
    return fileRefMap;
}

/**
 * 从PBXGroup中读出所有文件的identifier，用于验证PBXFileReference中的文件是否都在PBXGroup中
 * @return {Map} {fileReference : filename,...}
 *         item举例: 020582A31D059B98004C1FC1 : TouchID_Tip.png
 */
async function processGroupRef(){
    let PBXGroupPath = handleTempDir + '/PBXGroup';
    // 首先选出所有的文件夹
    let shStr = `sed -n '/{$/p' ${PBXGroupPath}`;
    let resstr = await exec(shStr);
    let lines = resstr.split('\n');

    let dirSet = new Set();
    for(let i=0;i<lines.length;i++){
        let tempstr = lines[i].trim();
        if(tempstr.length < idLength){
            continue;
        }
        let dirId = matchStr(tempstr,IdentifierRE);
        if(dirId.length < idLength){
            continue;
        }
        dirSet.add(dirId);
    }
    // 找出所有的文件
    shStr = `sed -n '/children = (/,/);/p' ${PBXGroupPath}`;
    resstr = await exec(shStr);
    lines = resstr.split('\n');
    let groupRefMap = new Set();
    for(let i=0;i<lines.length;i++){
        let tempstr = lines[i].trim();
        if(tempstr.length < idLength){
            continue;
        }
        let identifer = matchStr(tempstr,IdentifierRE);
        if(identifer.length < 1){
            console.log("PBXGroup section中存在错误：",tempstr);
        }
        if(!dirSet.has(identifer)){
            groupRefMap.add(identifer);
        }
    }
    dirSet.clear();
    return groupRefMap;
}

/**
 * 从PBXVariantGroup中读出所有locationFile的identifier
 * BuildFileSection中部分文件的fileRef是在此section中而不是直接在fileRefMap中，要经过此section找到对应fileRefMap中的文件
 * @return {Map} {fileReference : Map,...}
 *         形式: {546F4C1C1CDB360C0056F4F6 : {0400FF1A143172CC00DC651B:Interface.storyboard},...}
 *         546F4C1C1CDB360C0056F4F6 对应在PBXBuildFile中,0400FF1A143172CC00DC651B对应在PBXFileReference中
 */
async function processVariantGroupRef(){
    let PBXVariantGroupPath = handleTempDir + '/PBXVariantGroup';
    let shStr = `cat ${PBXVariantGroupPath}`;
    let resstr = await exec(shStr);
    let lines = resstr.split('\n');

    let resultMap = new Map();
    let childMap = new Map();
    let outerId = "",outername = "";
    for(let i=0;i<lines.length;i++){
        let tempstr = lines[i].trim();
        if(tempstr.slice(-2) == "};"){
            if(outerId.length>1 && outername.length>1 ){
                if (childMap.size>0){
                    resultMap.set(outerId,new Map(childMap));
                } else {
                    console.log(`PBXVariantGroup ${outerId} ${outername} 有问题`);
                }
            }
            continue; 
        }
        let tempidentifer = matchStr(tempstr,IdentifierRE);
        let tempname = matchStr(tempstr,NameRE).slice(3,-3);
        if(tempidentifer.length > 1 && tempname.length > 0){
            if(tempstr.slice(-6) === "*/ = {"){
                outerId = tempidentifer;
                outername = tempname;
                childMap.clear();
            } else {
                if(outerId.length < 1 || outername.length < 1){
                    console.log("PBXVariantGroup 文件格式有问题");
                }
                childMap.set(tempidentifer,tempname);
            }
        }
    }
    return resultMap;
}

/**
 * 把所有的资源文件都读到内存的Map中，key就是resource的identifier，value是对应资源文件的Map
 * @param {Object} targetInfo {targetname : Map}, 举例:{EQHexin : {Resources : 1D60588D0D05DD3D006BFB54,...},...} 
 * @return {Map} {resouceTagIdentifier : Map} 
 *         item举例 : 55F7F9E91DFA8AD8009D2926 : {jiaoyi.png in Resources: 3DB8BF241AE51FDE00DD74F8,...} 
 */
async function getALLTargetSource(targetInfo,pbxFilePath){
    if(!targetInfo || !pbxFilePath){
        console.log("target 对应资源索引未获取到");
        return;
    }
    let sourcesMap = new Map();
    for(var targetName in targetInfo){
        let infoMap = targetInfo[targetName];
        for(let item of infoMap){
            let identifier = item[1];
            let shStr = `sed -n '/${identifier}/,/};/p' ${pbxFilePath} | sed -n '/files = (/,/);/p'`;
            let resstr = await exec(shStr);
            let tempMap = await analyseStr(resstr,"files = (",");");
            sourcesMap.set(identifier,tempMap);
        }
    }
    return sourcesMap;
}

/**
 * 每个target中的每个资源依次检查下面四项是否都存在 : PBXBuildFile，PBXFileReference，PBXGroup，本地文件
 * @param {Object} targetInfo {targetname : Map} 
 *                 举例:{EQHexin : {Resources : 1D60588D0D05DD3D006BFB54,...},...} 
 * @param {Object} allSourceMap {resouceTagIdentifier : Map}
 *                 举例: {1D60588D0D05DD3D006BFB54 : {jiaoyi.png in Resources: 3DB8BF241AE51FDE00DD74F8,...},...}
 * @param {Map} buildRefMap  {fileReference : [fileReference,filename]}
 * @param {Map} fileRefMap   {fileReference : filename}
 * @param {Map} groupRefMap  {fileReference : filename}
 * @param {Map} variantMap   {fileReference : filename}
 * @param {Set} filesSet     {filenames}
 */
async function checkTargets(targetInfo,allSourceMap,buildRefMap,fileRefMap,groupRefMap,variantMap,filesSet){
    if(!targetInfo || !allSourceMap || !buildRefMap || !fileRefMap || !groupRefMap){
        console.log("处理过程中遇到未知错误");
        return;
    }
    for(var targetName in targetInfo){
        let infoMap = targetInfo[targetName];
        for(let resTagItem of infoMap){
            let resouceTagIdentifier = resTagItem[1];
            let subSourceMap = allSourceMap.get(resouceTagIdentifier);
            for(let resitem of subSourceMap){
                let resName = resitem[0];
                let resIdentifier = resitem[1];

                let buildInfo = buildRefMap.get(resIdentifier);
                if(!buildInfo){
                    console.log("build 中不存在该文件: ",resName,resIdentifier);
                    continue;
                }
                buildRefMap.delete(resIdentifier);
                
                let fileRef = buildInfo[0];
                let filename = buildInfo[1];

                if(!groupRefMap.has(fileRef)){
                    console.log("groupRef 中不存在该文件: ",buildInfo[0]," ",buildInfo[1]);
                }

                // 查看是否在PBXVariantGroup中存在
                let fileMap = variantMap.get(fileRef);
                if(!fileMap){
                    fileMap = new Map();
                    fileMap.set(fileRef,filename);
                }
                
                for(let item of fileMap){
                    let fileIdentifier = item[0];
                    let realname = fileRefMap.get(fileIdentifier);
                    if(!realname){
                        console.log("fileRef 中不存在该文件: ",fileIdentifier,filename);
                    }
                    if(filesSet && filesSet.size > 1 && !checkFileExist(realname,filesSet)){
                        console.log("该物理文件不存在: ",buildInfo[0],realname);
                    }
                }
            }
        }
    }
    for(let buildItem of buildRefMap){
        console.log(`PBXBuildFile 多余文件 : sourceid: ${buildItem[0]}  name: ${buildItem[1][1]}`);
    }
}

function checkFileExist(filename,filesSet){
    if(!filename || filesSet.size < 2){
        return false;
    }
    
    filename = path.basename(filename);
    if(filesSet.has(filename.toLowerCase())){
        return true;
    } else if(!opts.verbose &&
             (filename.indexOf(".framework") != -1 || 
              filename.indexOf(".tbd") != -1 || 
              filename.indexOf(".app") != -1 ||
              filename.indexOf(".dylib") != -1)) {
        return true;
    } else {
        return false;
    }
}

/**
 * 从XCConfigurationList文件读出每个target的所有版本(beta,release,build,adhoc等)的配置表
 * @return {Object} {string : Map} => {targetname : {specices: identifier,...}...}
 *         举例：{WatchPro Extension : {Debug : 04472FEA1CDC8CA900B3160B,...}...}
 */
async function getConfigurationList(){
    let PBXConfigurationList = handleTempDir + '/XCConfigurationList';
    let shStr = `cat ${PBXConfigurationList}`;
    let resstr = await exec(shStr);
    let lines = resstr.split('\n');
    let length = lines.length;
    const TargetNameRE = /"[^\*\/]*"/;
    let targetname = "";
    let tempmap = new Map();
    let configList = {};
    for(let i=0;i<length;i++){
        let tempstr = lines[i];
        tempstr = tempstr.trim();
        let tempname = matchStr(tempstr,TargetNameRE);
        if(tempname.length > 2){
            tempname = tempname.slice(1,-1);
            if(targetname.length > 1 && tempmap.size > 0) {
                configList[targetname] = new Map(tempmap);
            }
            targetname = tempname;
            tempmap.clear();
            continue;
        }
        let identifier = matchStr(tempstr,IdentifierRE);
        if(identifier.length < 1) {
            continue;
        }
        let specices = matchStr(tempstr,NameRE);
        if(specices.length > 6) {
            specices = specices.slice(3,-3);
            tempmap.set(specices,identifier);
        }
    }
    return configList;
}

/**
 * 根据configList从XCBuildConfiguration中找到所有的target的DSYM标示
 * @param {Object} configList {string : Map} => {targetname : {specices: identifier,...}...}
 */
async function checkDSYM(configList){
    if(!configList){
        console.log("工程配置列表未找到");
        process.exit();
    }
    let PBXBuildConfigurationPath = handleTempDir + '/XCBuildConfiguration';
    const dsym = "dwarf-with-dsym";
    for(let targetname in configList){
        let infoMap = configList[targetname];
        for(let item of infoMap){
            let specices = item[0];
            let identifier  = item[1];
            let shStr = `sed -n '/${identifier}/,/}\;/p' ${PBXBuildConfigurationPath} | sed -n '/DEBUG_INFORMATION_FORMAT/p'`;
            let resstr = await exec(shStr);
            resstr = resstr.trim();
            if(resstr.length > 1 && resstr.indexOf(dsym) === -1){
                console.log(targetname," : ",specices," : ",resstr);
            }
        }
    }
}

async function fileList(desPath){
    // ls -R | sed '/^.\//d' | sed '/^$/d'
    let shStr = `ls -R ${desPath} | sed '/^.\\//d' | sed '/^$/d' | sed '/:/d'`;
    let resstr = await exec(shStr);
    let lines = resstr.split('\n');
    let filesSet = new Set();
    for(let i=0;i<lines.length;i++){
        let str = lines[i];
        str = str.trim().toLowerCase();
        filesSet.add(str);
    }
    return filesSet;
}

function matchStr(str,regexp){
    let res = null;
    if(str && regexp) {
        let resary = str.match(regexp);
        if(resary) {
            res = resary[0];
        }
    }
    return res || "";
}

start();