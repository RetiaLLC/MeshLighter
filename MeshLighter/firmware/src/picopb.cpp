#include "picopb.h"

picopb::picopb(uint8_t *buffer,size_t length)
{
   this->buffer = buffer;
   this->length = length;
   this->offset = 0;
   this->next_size = 0;
   this->next_type = pb_type::INVALID;
}

uint64_t picopb::decode_varint(size_t *size)
{
   int index = offset + 1;
   uint64_t value = 0;
   while(index < length)
   {
      value<<=7;
      value|=(buffer[index]&0x7F);
      if((buffer[index]&0x80)==0)
      {
         index++;
         break;
      }
      index++;

   }
   if(size)
   {
      *size = index - offset - 1;
   }
   return value;
}

int picopb::skip()
{
   offset += next_size + 1;
   next_type = pb_type::INVALID;
   return 1;
}
int picopb::read_varint(uint64_t *out)
{
   if(next_type != pb_type::VARINT)
   {
      return 0;
   }
   *out = decode_varint(0);
   offset += next_size + 1;
   next_type = pb_type::INVALID;
   return 1;
}

int picopb::read_i64(uint64_t *out)
{
   if(next_type != pb_type::I64)
   {
      return 0;
   }
   memcpy(out,&buffer[offset+1],8);
   offset += 9;
   next_type = pb_type::INVALID;
   return 1;
}

int picopb::read_string(uint8_t *string,uint16_t bufsz)
{
   int i;
   uint64_t string_len;
   size_t varint_len;
   if(next_type != pb_type::STRING)
   {
      return 0;
   }
   string_len = decode_varint(&varint_len);
   if(string_len > bufsz)
   {
      string_len = bufsz;
   }
   for(i=0;i<string_len;i++)
   {
      string[i] = buffer[offset+varint_len+i+1];
   }
   //memcpy(string,&buffer[offset+varint_len+1],string_len);
   offset += next_size + 1;
   return 0;
}

int picopb::read_i32(uint32_t *out)
{
   if(next_type != pb_type::I32)
   {
      return 0;
   }
   memcpy(out,&buffer[offset+1],4);
   offset += 5;
   next_type = pb_type::INVALID;
   return 1;
}

int picopb::encode_varint(uint64_t num)
{
   int shift;
   for(shift=56;shift > 0;shift-=7)
   {
      if((num>>shift)&0x7F)
      {
         break;
      }
   }
   for(;shift >= 0;shift-=7)
   {
      buffer[offset++]=(num>>shift)|0x80;
   }
   buffer[offset-1]&=~0x80;
   return 0;
}

int picopb::write_varint(int id, uint64_t num)
{
   buffer[offset++] = (id << 3) | pb_type::VARINT;
   encode_varint(num);
   return 0;
}

int picopb::write_i64(int id, uint64_t num)
{
   buffer[offset++] = (id<<3) | pb_type::I64;
   memcpy(&buffer[offset],&num,8);
   offset+=8;
   return 0;
}

int picopb::write_i32(int id, uint32_t num)
{
   buffer[offset++] = (id<<3) | pb_type::I32;
   memcpy(&buffer[offset],&num,4);
   offset+=4;
   return 0;
}

int picopb::write_string(int id, uint8_t *bytes, int len)
{
   int i;
   buffer[offset++] = (id << 3) | pb_type::STRING;
   encode_varint(len);
   for(i=0;i<len;i++)
   {
      buffer[offset++] = bytes[i];
   }
   return 0;
}

int picopb::get_length()
{
   return offset;
}

pb_type picopb::decode_next(int *id,size_t *size)
{
   size_t string_len;
   if(offset >= length)
   {
      *size = 0;
      *id = 0;
      return pb_type::INVALID;
   }
   *id = buffer[offset] >> 3;
   next_type = (pb_type)(buffer[offset] & 7);
   switch(next_type)
   {
      case pb_type::VARINT:
         decode_varint(&next_size);
         *size = next_size;
         break;
      case pb_type::I64:
         next_size = 8;
         *size = next_size;
         break;
      case pb_type::STRING:
         string_len = decode_varint(&next_size);
         next_size += string_len;
         *size = string_len;
         break;
      case pb_type::I32:
         next_size = 4;
         *size = next_size;
         break;
      default:
         next_type = pb_type::INVALID;
         next_size = 0;
         *size = next_size;
         break;
   }

   return next_type;
}
