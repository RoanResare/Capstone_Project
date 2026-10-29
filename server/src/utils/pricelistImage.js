const { ApiError } = require("./ApiError");
function validateImage(dataUrl) {
 const match = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
 if (!match) throw new ApiError(400, "Choose a valid JPG, PNG, or WebP image.");
 const buffer = Buffer.from(match[2], "base64");
 if (!buffer.length || buffer.length > 5*1024*1024 || buffer.toString("base64") !== match[2]) throw new ApiError(400, "Choose a nonempty image up to 5 MB.");
 const png = buffer.length >= 33 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString("ascii",12,16) === "IHDR" && buffer.readUInt32BE(16)>0 && buffer.readUInt32BE(20)>0 && buffer.subarray(-8,-4).toString() === "IEND";
 const jpeg = buffer.length>20 && buffer[0]===255 && buffer[1]===216 && buffer[2]===255 && buffer[buffer.length-2]===255 && buffer[buffer.length-1]===217;
 const webp = buffer.length>=30 && buffer.toString("ascii",0,4)==="RIFF" && buffer.toString("ascii",8,12)==="WEBP" && ["VP8 ","VP8L","VP8X"].includes(buffer.toString("ascii",12,16)) && buffer.readUInt32LE(4)+8===buffer.length;
 if (!(match[1]==="image/png"?png:match[1]==="image/jpeg"?jpeg:webp)) throw new ApiError(400,"The file contents do not match a supported image.");
 return {buffer,contentType:match[1]};
}
module.exports={validateImage};