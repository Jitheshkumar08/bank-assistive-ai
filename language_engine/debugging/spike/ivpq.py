"""Minimal Thrift-compact decoder for Parquet footers, OffsetIndex and PageHeaders.

Copied unchanged from the Phase 3.2B-8 extraction tooling so the banking
extraction uses the same reader. Only what page-level extraction needs.
Structs decode to {field_id: value}.
"""
import struct


class Reader:
    def __init__(self, buf, pos=0):
        self.buf = buf
        self.pos = pos

    def byte(self):
        b = self.buf[self.pos]
        self.pos += 1
        return b

    def varint(self):
        shift = result = 0
        while True:
            b = self.byte()
            result |= (b & 0x7F) << shift
            if not b & 0x80:
                return result
            shift += 7

    def zigzag(self):
        n = self.varint()
        return (n >> 1) ^ -(n & 1)

    def value(self, ftype):
        if ftype == 1:
            return True
        if ftype == 2:
            return False
        if ftype == 3:
            v = self.buf[self.pos]
            self.pos += 1
            return v
        if ftype in (4, 5, 6):
            return self.zigzag()
        if ftype == 7:
            v = struct.unpack_from("<d", self.buf, self.pos)[0]
            self.pos += 8
            return v
        if ftype == 8:
            n = self.varint()
            v = bytes(self.buf[self.pos:self.pos + n])
            self.pos += n
            return v
        if ftype in (9, 10):
            head = self.byte()
            size = head >> 4
            etype = head & 0x0F
            if size == 15:
                size = self.varint()
            out = []
            for _ in range(size):
                if etype in (1, 2):
                    out.append(self.byte() == 1)
                else:
                    out.append(self.value(etype))
            return out
        if ftype == 11:
            size = self.varint()
            if size == 0:
                return {}
            kv = self.byte()
            kt, vt = kv >> 4, kv & 0x0F
            return {self.value(kt): self.value(vt) for _ in range(size)}
        if ftype == 12:
            return self.struct()
        raise ValueError(f"unknown thrift compact type {ftype} at {self.pos}")

    def struct(self):
        out = {}
        last = 0
        while True:
            head = self.byte()
            if head == 0:
                return out
            delta = head >> 4
            ftype = head & 0x0F
            fid = last + delta if delta else self.zigzag()
            out[fid] = self.value(ftype)
            last = fid


def footer_length(tail8):
    assert tail8[4:] == b"PAR1", "not a parquet file"
    return struct.unpack("<I", tail8[:4])[0]


def audio_chunks(file_meta, leaf_name=b"bytes", parent=b"audio_filepath"):
    """Yield (row_group_index, rg_num_rows, column_chunk) for the audio bytes leaf."""
    for g, rg in enumerate(file_meta[4]):
        for cc in rg[1]:
            path = cc[3][3]
            if path == [parent, leaf_name]:
                yield g, rg[3], cc


def page_locations(offset_index):
    return [{"offset": p[1], "size": p[2], "first_row": p[3]} for p in offset_index[1]]
