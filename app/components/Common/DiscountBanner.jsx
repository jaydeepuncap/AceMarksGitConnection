import React from 'react'
import { Banner } from '../ui'

const DiscountBanner = () => {
  return (
    <Banner tone={"info"}>Note: You can activate a maximum of 25 app-generated function-based automatic discounts per store at a time.</Banner>

  )
}

export default React.memo(DiscountBanner);