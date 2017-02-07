"use strict";
var EBMLEncoder_1 = require("./EBMLEncoder");
var Buffer = require("buffer/").Buffer;
exports.ebmlBlock = require("ebml-block");
/**
 * @return - SimpleBlock to WebP Filter
 */
function WebPFrameFilter(elms) {
    return WebPBlockFilter(elms).reduce(function (lst, elm) {
        var o = exports.ebmlBlock(elm.data);
        return o.frames.reduce(function (lst, frame) {
            // https://developers.Blob.com/speed/webp/docs/riff_container
            var webpBuf = VP8BitStreamToRiffWebPBuffer(frame);
            var webp = new Blob([webpBuf], { type: "image/webp" });
            return lst.concat(webp);
        }, lst);
    }, []);
}
exports.WebPFrameFilter = WebPFrameFilter;
/**
 * WebP ファイルにできる SimpleBlock の パスフィルタ
 */
function WebPBlockFilter(elms) {
    return elms.reduce(function (lst, elm) {
        if (elm.type !== "b") {
            return lst;
        }
        if (elm.name !== "SimpleBlock") {
            return lst;
        }
        var o = exports.ebmlBlock(elm.data);
        var hasWebP = o.frames.some(function (frame) {
            // https://tools.ietf.org/html/rfc6386#section-19.1
            var startcode = frame.slice(3, 6).toString("hex");
            return startcode === "9d012a";
        });
        if (!hasWebP) {
            return lst;
        }
        return lst.concat(elm);
    }, []);
}
exports.WebPBlockFilter = WebPBlockFilter;
/**
 * @param frame - VP8 BitStream のうち startcode をもつ frame
 * @return - WebP ファイルの ArrayBuffer
 */
function VP8BitStreamToRiffWebPBuffer(frame) {
    var VP8Chunk = createRIFFChunk("VP8 ", new Buffer(frame));
    var WebPChunk = Buffer.concat([
        new Buffer("WEBP", "ascii"),
        new Buffer(VP8Chunk)
    ]);
    return createRIFFChunk("RIFF", WebPChunk);
}
exports.VP8BitStreamToRiffWebPBuffer = VP8BitStreamToRiffWebPBuffer;
/**
 * RIFF データチャンクを作る
 */
function createRIFFChunk(FourCC, chunk) {
    var chunkSize = new Buffer(4);
    chunkSize.writeUInt32LE(chunk.byteLength, 0);
    return Buffer.concat([
        new Buffer(FourCC.substr(0, 4), "ascii"),
        chunkSize,
        new Buffer(chunk),
        new Buffer(chunk.byteLength % 2 === 0 ? 0 : 1) // padding
    ]).buffer;
}
exports.createRIFFChunk = createRIFFChunk;
/**
 * metadata に対して duration と seekhead を追加した metadata を返す
 * @param metadata - 変更前の webm における ファイル先頭から 最初の Cluster 要素までの 要素
 * @param clusterPtrs - 変更前の webm における SeekHead に追加する Cluster 要素 への start pointer
 * @param duration - Duration に記載する値
 */
function putRefinedMetaData(metadata, clusterPtrs, duration) {
    var lastmetadata = metadata[metadata.length - 1];
    if (lastmetadata == null) {
        throw new Error("metadata not found");
    }
    if (lastmetadata.dataEnd < 0) {
        throw new Error("metadata does not have size");
    } // metadata が 不定サイズ
    var metadataSize = lastmetadata.dataEnd; // 書き換える前の metadata のサイズ
    var refineMetadata = function (sizeDiff) {
        if (sizeDiff === void 0) { sizeDiff = 0; }
        var _metadata = metadata.slice(0);
        if (typeof duration === "number") {
            // duration を追加する
            for (var i = 0; i < _metadata.length; i++) {
                var elm = _metadata[i];
                if (elm.type === "m" && elm.name === "Info" && elm.isEnd) {
                    var durBuf = new Buffer(4);
                    durBuf.writeFloatBE(duration, 0);
                    var durationElm = { name: "Duration", type: "f", data: durBuf };
                    _metadata.splice(i, 0, durationElm); // </Info> 前に <Duration /> を追加
                    i++; // <duration /> 追加した分だけインクリメント
                }
            }
        }
        var seekHead = [];
        seekHead.push({ name: "SeekHead", type: "m" });
        clusterPtrs.forEach(function (start) {
            seekHead.push({ name: "Seek", type: "m" });
            // [0x1F, 0x43, 0xB6, 0x75] で Cluster の意
            seekHead.push({ name: "SeekID", type: "b", data: new Buffer([0x1F, 0x43, 0xB6, 0x75]) });
            var posBuf = new Buffer(4); // 実際可変長 int なので 4byte 固定という実装は良くない
            // しかし ms 単位だとすれば 0xFFFFFFFF は 49 日もの時間を記述できるので実用上問題ない
            // 64bit や 可変長 int を js で扱うの面倒
            var offset = start + sizeDiff;
            posBuf.writeUInt32BE(offset, 0);
            seekHead.push({ name: "SeekPosition", type: "u", data: posBuf });
            seekHead.push({ name: "Seek", type: "m", isEnd: true });
        });
        seekHead.push({ name: "SeekHead", type: "m", isEnd: true });
        _metadata = _metadata.concat(seekHead); // metadata 末尾に <SeekHead /> を追加
        return _metadata;
    };
    var encorder = new EBMLEncoder_1.default();
    // 一旦 seekhead を作って自身のサイズを調べる
    var bufs = refineMetadata(0).reduce(function (lst, elm) { return lst.concat(encorder.encode([elm])); }, []);
    var totalByte = bufs.reduce(function (o, buf) { return o + buf.byteLength; }, 0);
    // 自分自身のサイズを考慮した seekhead を再構成する
    //console.log("sizeDiff", totalByte - metadataSize);
    return refineMetadata(totalByte - metadataSize);
}
exports.putRefinedMetaData = putRefinedMetaData;